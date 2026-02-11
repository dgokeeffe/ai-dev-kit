"""Multi-session PTY manager for Claude Code workshop sessions.

Spawns, tracks, and tears down Claude Code PTY processes.  Each user
can have multiple named sessions (e.g. "pipeline", "app-1", "app-2"),
each running an independent Claude Code CLI in its own workspace.

Key differences from the code-server InstanceManager:
  - Multiple sessions per user (keyed by user_email + session_name).
  - Direct PTY (pty.openpty) instead of subprocess → internal HTTP server.
  - Ring-buffer per session for reconnection replay.
  - Pub/sub: a single reader thread broadcasts PTY output to all
    connected WebSocket consumers via asyncio.Queue.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import pty
import signal
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock, Thread

logger = logging.getLogger(__name__)

WORKSPACES_DIR = Path(os.getenv("WORKSPACES_DIR", "./workspaces"))
TRANSCRIPTS_DIR = Path(os.getenv("TRANSCRIPTS_DIR", "./transcripts"))
IDLE_TIMEOUT_MINUTES = int(os.getenv("IDLE_TIMEOUT_MINUTES", "0"))  # 0 = disabled
MAX_SESSIONS = int(os.getenv("MAX_SESSIONS", "50"))
MAX_SESSIONS_PER_USER = int(os.getenv("MAX_SESSIONS_PER_USER", "10"))
OUTPUT_BUFFER_MAXLEN = int(os.getenv("OUTPUT_BUFFER_MAXLEN", "200000"))


@dataclass
class ClaudeSession:
    """Tracks a running Claude Code PTY process.

    The reader thread is the single consumer of master_fd output.  It
    writes every chunk into ``output_buffer`` (for reconnection replay)
    and pushes it into every subscriber's ``asyncio.Queue`` so that
    connected WebSocket handlers receive data without contention.
    """

    session_id: str
    user_email: str
    session_name: str
    master_fd: int
    pid: int
    workspace_dir: Path
    output_buffer: deque = field(
        default_factory=lambda: deque(maxlen=OUTPUT_BUFFER_MAXLEN)
    )
    last_activity: float = field(default_factory=time.time)
    started_at: float = field(default_factory=time.time)
    alive: bool = True
    _reader_thread: Thread | None = field(default=None, repr=False)
    _subscribers: list[asyncio.Queue] = field(default_factory=list, repr=False)
    _loop: asyncio.AbstractEventLoop | None = field(default=None, repr=False)
    _transcript_file: object | None = field(default=None, repr=False)  # IO[bytes]

    def subscribe(self) -> asyncio.Queue:
        """Create a new subscriber queue for WebSocket consumers."""
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    @property
    def idle_seconds(self) -> float:
        return time.time() - self.last_activity

    def touch(self) -> None:
        self.last_activity = time.time()

    @property
    def transcript_path(self) -> str | None:
        if self._transcript_file and hasattr(self._transcript_file, "name"):
            return self._transcript_file.name  # type: ignore[union-attr]
        return None

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "user_email": self.user_email,
            "session_name": self.session_name,
            "workspace_dir": str(self.workspace_dir),
            "alive": self.alive,
            "idle_seconds": round(self.idle_seconds),
            "uptime_seconds": round(time.time() - self.started_at),
            "transcript_path": self.transcript_path,
        }


class SessionManager:
    """Manages multiple Claude Code PTY sessions across users."""

    def __init__(self) -> None:
        self._sessions: dict[str, ClaudeSession] = {}
        self._lock = Lock()
        self._cleanup_task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start_cleanup_loop(self) -> None:
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(60)
            try:
                self._cleanup_idle()
            except Exception:
                logger.exception("Error in session cleanup loop")

    def _cleanup_idle(self) -> None:
        to_remove: list[str] = []

        with self._lock:
            for sid, session in self._sessions.items():
                if not session.alive:
                    to_remove.append(sid)
                elif IDLE_TIMEOUT_MINUTES > 0 and session.idle_seconds > (
                    IDLE_TIMEOUT_MINUTES * 60
                ):
                    logger.info(
                        "Stopping idle session %s (%s/%s, idle %.0fs)",
                        sid,
                        session.user_email,
                        session.session_name,
                        session.idle_seconds,
                    )
                    to_remove.append(sid)

        for sid in to_remove:
            self.stop_session(sid)

    # ------------------------------------------------------------------
    # Session CRUD
    # ------------------------------------------------------------------

    def create_session(
        self,
        user_email: str,
        session_name: str,
        env: dict[str, str] | None = None,
        workspace_override: str | None = None,
    ) -> ClaudeSession:
        """Create a new Claude Code PTY session.

        Args:
            user_email: Databricks user email.
            session_name: Friendly name (e.g. "pipeline", "app-1").
            env: Extra environment variables for the child process.
            workspace_override: Absolute path to use as the session workspace
                (e.g. an existing git repo). If None, uses the default
                WORKSPACES_DIR/<user_hash>/<session_name>.

        Returns:
            The newly created ClaudeSession.

        Raises:
            RuntimeError: If capacity limits are reached.
        """
        session_id = uuid.uuid4().hex[:12]
        if workspace_override:
            workspace_dir = Path(workspace_override)
        else:
            user_hash = hashlib.sha256(user_email.lower().encode()).hexdigest()[:12]
            workspace_dir = WORKSPACES_DIR / user_hash / session_name

        with self._lock:
            active = sum(1 for s in self._sessions.values() if s.alive)
            if active >= MAX_SESSIONS:
                raise RuntimeError(f"Maximum sessions ({MAX_SESSIONS}) reached")

            # Prevent duplicate session names for the same user
            for s in self._sessions.values():
                if s.user_email == user_email and s.session_name == session_name:
                    return s

            user_sessions = [
                s
                for s in self._sessions.values()
                if s.alive and s.user_email == user_email
            ]
            if len(user_sessions) >= MAX_SESSIONS_PER_USER:
                raise RuntimeError(
                    f"Maximum sessions per user ({MAX_SESSIONS_PER_USER}) reached"
                )

            # Register a placeholder immediately to prevent races
            placeholder = ClaudeSession(
                session_id=session_id,
                user_email=user_email,
                session_name=session_name,
                workspace_dir=str(workspace_dir),
                pid=-1,
                master_fd=-1,
            )
            self._sessions[session_id] = placeholder

        workspace_dir.mkdir(parents=True, exist_ok=True)

        # Resolve Claude Code CLI binary
        claude_bin = self._resolve_claude_binary()

        # Build child environment
        home_dir = os.environ.get("HOME", "/tmp/workshop-home")
        child_env = {
            **os.environ,
            "HOME": home_dir,
            "PWD": str(workspace_dir),
            "TERM": "xterm-256color",
            "LANG": "en_US.UTF-8",
            "PATH": f"{home_dir}/.local/bin:{os.environ.get('PATH', '/usr/bin')}",
        }
        # Strip OAuth tokens that cause scope issues in child
        for key in list(child_env.keys()):
            if "OAUTH" in key.upper():
                del child_env[key]
        if env:
            child_env.update(env)

        # Spawn PTY
        master_fd, slave_fd = pty.openpty()
        pid = os.fork()

        if pid == 0:
            # ---- Child process ----
            os.close(master_fd)
            os.setsid()

            # Attach to PTY slave
            import fcntl
            import termios

            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)

            os.chdir(str(workspace_dir))
            os.execvpe(
                claude_bin,
                [claude_bin, "--dangerously-skip-permissions"],
                child_env,
            )
            # execvpe never returns; if it fails the child exits
            os._exit(1)

        # ---- Parent process ----
        os.close(slave_fd)

        # Update placeholder with real pid/fd
        placeholder.pid = pid
        placeholder.master_fd = master_fd

        # Finalize the placeholder session with real values
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        placeholder._loop = loop
        placeholder.workspace_dir = str(workspace_dir)

        # Open transcript file for persistent output logging
        try:
            TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
            ts = time.strftime("%Y%m%d-%H%M%S")
            transcript_path = TRANSCRIPTS_DIR / f"{session_name}_{ts}_{session_id}.log"
            placeholder._transcript_file = open(transcript_path, "ab")  # noqa: SIM115
            logger.info("Transcript logging to %s", transcript_path)
        except Exception as e:
            logger.warning("Could not open transcript file: %s", e)

        # Start background reader thread — the *only* consumer of master_fd
        reader = Thread(
            target=self._reader_loop,
            args=(placeholder,),
            daemon=True,
            name=f"pty-reader-{session_id}",
        )
        placeholder._reader_thread = reader
        reader.start()

        logger.info(
            "Created session %s for %s/%s (pid=%d, workspace=%s)",
            session_id,
            user_email,
            session_name,
            pid,
            workspace_dir,
        )
        return placeholder

    def get_session(self, session_id: str) -> ClaudeSession | None:
        return self._sessions.get(session_id)

    def get_user_sessions(self, user_email: str) -> list[ClaudeSession]:
        return [s for s in self._sessions.values() if s.user_email == user_email]

    def stop_session(self, session_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(session_id, None)

        if session is None:
            return

        session.alive = False

        # Kill the process first — causes PTY EOF so the reader exits fast
        try:
            os.killpg(os.getpgid(session.pid), signal.SIGTERM)
        except (OSError, ProcessLookupError):
            try:
                os.kill(session.pid, signal.SIGTERM)
            except OSError:
                pass

        # Close PTY fd — signals the reader thread to exit
        try:
            os.close(session.master_fd)
        except OSError:
            pass

        # Non-blocking reap
        try:
            os.waitpid(session.pid, os.WNOHANG)
        except (OSError, ChildProcessError):
            pass

        logger.info(
            "Stopped session %s (%s/%s)",
            session_id,
            session.user_email,
            session.session_name,
        )

    def stop_all(self) -> None:
        with self._lock:
            session_ids = list(self._sessions.keys())
        for sid in session_ids:
            self.stop_session(sid)

    # ------------------------------------------------------------------
    # PTY I/O
    # ------------------------------------------------------------------

    def write_to_session(self, session_id: str, data: bytes) -> None:
        session = self.get_session(session_id)
        if session and session.alive:
            try:
                os.write(session.master_fd, data)
                session.touch()
            except OSError:
                session.alive = False

    def resize_session(self, session_id: str, rows: int, cols: int) -> None:
        session = self.get_session(session_id)
        if session and session.alive:
            try:
                import fcntl
                import struct
                import termios

                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(session.master_fd, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass

    def _reader_loop(self, session: ClaudeSession) -> None:
        """Background thread: read PTY output, buffer it, and broadcast.

        This is the *only* reader of ``session.master_fd``.  Each chunk is:
          1. Appended to the ring buffer (for reconnection replay).
          2. Pushed into every subscriber's asyncio.Queue via
             ``loop.call_soon_threadsafe`` so connected WebSocket handlers
             receive data without contention on the fd.
        """
        while session.alive:
            try:
                data = os.read(session.master_fd, 4096)
                if not data:
                    break
                session.output_buffer.append(data)
                session.touch()

                # Write to transcript file (persistent disk log)
                if session._transcript_file:
                    try:
                        session._transcript_file.write(data)  # type: ignore[union-attr]
                        session._transcript_file.flush()  # type: ignore[union-attr]
                    except Exception:
                        pass  # Don't crash the reader on transcript errors

                # Broadcast to all WebSocket subscribers
                for q in list(session._subscribers):
                    if session._loop is not None:
                        try:
                            session._loop.call_soon_threadsafe(q.put_nowait, data)
                        except (asyncio.QueueFull, RuntimeError):
                            pass  # Drop if consumer is too slow or loop is closed
            except OSError:
                break

        session.alive = False
        logger.debug("Reader loop ended for session %s", session.session_id)

        # Close transcript file
        if session._transcript_file:
            try:
                session._transcript_file.close()  # type: ignore[union-attr]
            except Exception:
                pass

        # Signal all subscribers that the session is done
        for q in list(session._subscribers):
            if session._loop is not None:
                try:
                    session._loop.call_soon_threadsafe(q.put_nowait, None)
                except (asyncio.QueueFull, RuntimeError):
                    pass

        # Reap the child process
        try:
            os.waitpid(session.pid, os.WNOHANG)
        except (OSError, ChildProcessError):
            pass

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def get_status(self) -> dict:
        return {
            "active_sessions": sum(1 for s in self._sessions.values() if s.alive),
            "max_sessions": MAX_SESSIONS,
            "sessions": [s.to_dict() for s in self._sessions.values()],
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_claude_binary() -> str:
        home = os.environ.get("HOME", "/tmp")
        candidates = [
            os.path.join(home, ".local", "bin", "claude"),
            "/app/python/source_code/node_modules/.bin/claude",
            "./node_modules/.bin/claude",
        ]
        for path in candidates:
            if os.path.isfile(path) and os.access(path, os.X_OK):
                return path
        return "claude"  # fall back to PATH lookup
