"""PTY HTTP polling endpoint for Claude Code terminal.

Spawns a PTY running Claude Code CLI with Databricks authentication,
using HTTP polling for I/O instead of WebSockets (Databricks Apps
reverse proxy does not support WebSocket upgrades).
"""

import base64
import fcntl
import logging
import os
import pty
import signal
import struct
import termios
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..services.backup_manager import ensure_project_directory
from ..services.claude_setup import prepare_pty_environment
from ..services.storage import ProjectStorage

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Session dataclass & global registry
# ---------------------------------------------------------------------------


@dataclass
class PtySession:
  """A live PTY session with its process and output buffer.

  Thread-safe output buffer access via output_lock for concurrent reader thread
  and HTTP polling endpoint.
  """

  session_id: str
  project_id: str
  user_email: str
  master_fd: int
  pid: int
  output_buffer: deque = field(default_factory=lambda: deque(maxlen=10000))
  output_lock: threading.Lock = field(default_factory=threading.Lock)
  last_activity: float = field(default_factory=time.time)
  alive: bool = True


_sessions: dict[str, PtySession] = {}
_sessions_lock = threading.Lock()

# Mtime cache to avoid repeated filesystem walks on every poll
_mtime_cache: dict[str, tuple[float, float]] = {}  # project_id -> (mtime, cache_time)
_mtime_cache_lock = threading.Lock()
MTIME_CACHE_TTL = 2.0  # Cache for 2 seconds

# Idle timeout - configurable via environment variable (default 30 minutes)
IDLE_TIMEOUT_SECONDS = int(os.getenv('PTY_IDLE_TIMEOUT', '1800'))


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class InputRequest(BaseModel):
  """Base64-encoded keystrokes to send to the PTY."""

  data: str


class ResizeRequest(BaseModel):
  """Terminal dimensions for PTY resize."""

  cols: int
  rows: int


# ---------------------------------------------------------------------------
# Helpers (kept from original implementation)
# ---------------------------------------------------------------------------


async def _verify_project_access(request: Request, project_id: str) -> Optional[str]:
  """Verify the user has access to the project and return the project directory path.

  Args:
      request: HTTP request
      project_id: Project UUID

  Returns:
      Path to the project directory as string, or None if access denied
  """
  try:
    user_email = request.headers.get('x-forwarded-user')
    if not user_email:
      if os.getenv('ENV', 'development') == 'development':
        user_email = 'dev-user@local'
      else:
        return None

    storage = ProjectStorage(user_email)
    project = await storage.get(project_id)
    if not project:
      return None

    project_dir = ensure_project_directory(project_id)
    return str(project_dir)
  except Exception as e:
    logger.error(f'Error verifying project access: {e}')
    return None


def _get_user_email(request: Request) -> str:
  """Extract user email from request headers or fall back to dev default."""
  email = request.headers.get('x-forwarded-user')
  if not email and os.getenv('ENV', 'development') == 'development':
    email = 'dev-user@local'
  return email or 'unknown'


def _get_databricks_credentials_from_headers(request: Request) -> tuple[str | None, str | None]:
  """Extract Databricks credentials from request headers or environment.

  In production (Databricks Apps), only uses X-Forwarded-Access-Token and
  workspace URL from env/DATABRICKS_HOST. Never falls back to WorkspaceClient(),
  because that returns the service principal's OAuth token, which causes
  "403 Invalid scope" for Foundation Model API.

  Args:
      request: HTTP request

  Returns:
      Tuple of (host, token) - token may be None if not available
  """
  from ..services.user import get_workspace_url

  token = request.headers.get('X-Forwarded-Access-Token')
  app_url = request.headers.get('X-Forwarded-Host')
  host = get_workspace_url(app_url)

  token_len = len(token) if token else 0
  logger.info(f'PTY credentials - host: {host}, has_token: {bool(token)}, token_len: {token_len}')

  if host and token:
    if not host.startswith('http'):
      host = f'https://{host}'
    logger.info('PTY: Using production credentials (X-Forwarded-Access-Token)')
    return host, token

  # Fall back to env vars (development only)
  is_development = os.getenv('ENV', 'development') == 'development'
  if is_development:
    host = os.getenv('DATABRICKS_HOST')
    token = os.getenv('DATABRICKS_TOKEN')
    if host and token:
      return host, token

    # In development only: fall back to WorkspaceClient (databricks auth login)
    try:
      from databricks.sdk import WorkspaceClient

      client = WorkspaceClient()
      host = client.config.host
      token = client.config.token
      auth = getattr(client.config, 'authenticate', None)
      if not token and callable(auth):
        headers: dict[str, str] = {}
        auth(headers)
        auth_header = headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
          token = auth_header[7:]
      if host:
        return host, token
    except Exception as e:
      logger.warning(f'Failed to get credentials from WorkspaceClient: {e}')

  # Production: optional PAT fallback for debugging (USE_PAT_FALLBACK=1 + DATABRICKS_TOKEN)
  if not is_development and os.getenv('USE_PAT_FALLBACK', '').lower() in ('1', 'true', 'yes'):
    pat = os.getenv('DATABRICKS_TOKEN')
    if host and pat:
      logger.warning(
        'PTY production: using PAT fallback (USE_PAT_FALLBACK=1). For debugging only.'
      )
      return host, pat

  # Production without token: return host if we have it (caller will 403)
  if host:
    return host, None
  return None, None


def _build_claude_env(host: str | None, token: str | None, project_dir: str) -> dict:
  """Build environment variables for Claude Code CLI.

  Claude auth is configured via ~/.claude/settings.json (created by prepare_pty_environment)
  so we don't need to set ANTHROPIC_* env vars here. Just set up the shell environment.

  Args:
      host: Databricks workspace URL (unused - kept for compatibility)
      token: User's Databricks access token (unused - kept for compatibility)
      project_dir: Project working directory

  Returns:
      Environment dict for subprocess
  """
  env = os.environ.copy()

  # Strip OAuth credentials to avoid scope issues with other tools
  env.pop('DATABRICKS_CLIENT_ID', None)
  env.pop('DATABRICKS_CLIENT_SECRET', None)

  # Claude auth configured via ~/.claude/settings.json (not env vars)
  logger.info('PTY env: Claude auth configured via ~/.claude/settings.json')

  home = os.environ.get('HOME', '/tmp')
  env['HOME'] = home
  env['PWD'] = project_dir
  env['TERM'] = 'xterm-256color'

  # Include ~/.local/bin in PATH for micro text editor
  local_bin = os.path.join(home, '.local', 'bin')
  env['PATH'] = f'{local_bin}:{env.get("PATH", "/usr/bin:/bin")}'

  return env


def _set_winsize(fd: int, rows: int, cols: int):
  """Set the window size of a PTY.

  Args:
      fd: File descriptor of the PTY
      rows: Number of rows
      cols: Number of columns
  """
  winsize = struct.pack('HHHH', rows, cols, 0, 0)
  fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


# ---------------------------------------------------------------------------
# Background threads
# ---------------------------------------------------------------------------


def _reader_thread(session: PtySession):
  """Read PTY output into buffer. Runs in daemon thread.

  Thread-safe with output_lock to prevent race conditions with HTTP polling endpoint.
  """
  while session.alive:
    try:
      data = os.read(session.master_fd, 4096)
      if data:
        with session.output_lock:
          session.output_buffer.append(data)
      else:
        break  # EOF
    except OSError:
      break
  session.alive = False


def _cleanup_loop():
  """Periodically kill stale sessions. Runs in a single daemon thread."""
  while True:
    time.sleep(30)
    now = time.time()
    to_remove: list[str] = []

    with _sessions_lock:
      for sid, sess in _sessions.items():
        idle = now - sess.last_activity
        # Kill sessions idle for >IDLE_TIMEOUT_SECONDS, or dead sessions with drained buffers
        if idle > IDLE_TIMEOUT_SECONDS or (not sess.alive and len(sess.output_buffer) == 0):
          to_remove.append(sid)

    for sid in to_remove:
      _kill_session(sid)


def _kill_session(session_id: str) -> bool:
  """Terminate a PTY session and clean up resources.

  Returns True if a session was found and cleaned up.
  """
  with _sessions_lock:
    session = _sessions.pop(session_id, None)

  if session is None:
    return False

  session.alive = False

  # Close master fd
  try:
    os.close(session.master_fd)
  except OSError:
    pass

  # Terminate child process
  if session.pid > 0:
    try:
      os.kill(session.pid, signal.SIGTERM)
    except ProcessLookupError:
      pass
    except OSError:
      pass

    # Wait briefly then force-kill
    time.sleep(0.5)
    try:
      os.kill(session.pid, signal.SIGKILL)
    except ProcessLookupError:
      pass
    except OSError:
      pass

    # Reap zombie
    try:
      os.waitpid(session.pid, os.WNOHANG)
    except ChildProcessError:
      pass

  logger.info(f'Cleaned up PTY session {session_id}')
  return True


# Start the cleanup thread on module load
_cleanup_thread = threading.Thread(target=_cleanup_loop, daemon=True, name='pty-cleanup')
_cleanup_thread.start()


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------


@router.post('/projects/{project_id}/pty/create')
async def create_session(project_id: str, request: Request):
  """Create a new PTY session running Claude Code CLI."""
  # Verify project access
  project_dir = await _verify_project_access(request, project_id)
  if not project_dir:
    raise HTTPException(status_code=404, detail='Project not found or access denied')

  user_email = _get_user_email(request)

  # Get Databricks credentials
  host, token = _get_databricks_credentials_from_headers(request)

  is_development = os.getenv('ENV', 'development') == 'development'
  # Grep-friendly auth state for debugging when Databricks Apps logs are hard to see
  logger.info(
    'AUTH_DEBUG pty env=%s user_present=%s token_present=%s host_set=%s',
    os.getenv('ENV', 'development'),
    1 if user_email and user_email != 'unknown' else 0,
    1 if token else 0,
    1 if host else 0,
  )
  if not host:
    raise HTTPException(
      status_code=400,
      detail='Databricks host not configured. Please set DATABRICKS_HOST.',
    )
  if not is_development and not token:
    raise HTTPException(
      status_code=403,
      detail=(
        'Databricks credentials required for Claude terminal. '
        'Ensure the app proxy forwards X-Forwarded-Access-Token.'
      ),
    )

  logger.info(f'Starting Claude terminal with host={host}, has_token={bool(token)}')

  # Prepare Claude Code CLI environment (settings, git, skills, CLAUDE.md)
  home_dir = os.environ.get('HOME', '/tmp')
  prepare_pty_environment(home_dir, project_dir, host, token, user_email)

  # Build environment
  env = _build_claude_env(host, token, project_dir)

  # Create PTY
  master_fd, slave_fd = pty.openpty()

  try:
    _set_winsize(master_fd, 24, 80)

    pid = os.fork()
    if pid == 0:
      # --- Child process ---
      os.close(master_fd)
      os.setsid()
      fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)

      os.dup2(slave_fd, 0)
      os.dup2(slave_fd, 1)
      os.dup2(slave_fd, 2)
      if slave_fd > 2:
        os.close(slave_fd)

      os.chdir(project_dir)

      # Resolve Claude Code CLI binary
      claude_paths = [
        '/app/python/source_code/node_modules/.bin/claude',  # Databricks Apps deployment
        './node_modules/.bin/claude',  # Local with package.json
        'claude',  # Global install (local dev)
      ]

      claude_bin = None
      for path in claude_paths:
        if os.path.isfile(path) and os.access(path, os.X_OK):
          claude_bin = path
          break
      if claude_bin is None:
        claude_bin = 'claude'

      os.execvpe(
        claude_bin,
        [claude_bin, '--dangerously-skip-permissions'],
        env,
      )
    else:
      # --- Parent process ---
      os.close(slave_fd)

      session_id = str(uuid.uuid4())
      session = PtySession(
        session_id=session_id,
        project_id=project_id,
        user_email=user_email,
        master_fd=master_fd,
        pid=pid,
      )

      # Start reader thread
      reader = threading.Thread(
        target=_reader_thread, args=(session,), daemon=True, name=f'pty-reader-{session_id[:8]}'
      )
      reader.start()

      with _sessions_lock:
        _sessions[session_id] = session

      logger.info(f'Created PTY session {session_id} for project {project_id}')
      return {'session_id': session_id, 'status': 'created'}

  except Exception as e:
    # If fork hasn't happened yet or we're the parent and something failed
    try:
      os.close(master_fd)
    except OSError:
      pass
    try:
      os.close(slave_fd)
    except OSError:
      pass
    logger.error(f'Failed to create PTY session: {e}')
    raise HTTPException(status_code=500, detail=f'Failed to create terminal session: {e}')


def _get_session(project_id: str, session_id: str) -> PtySession:
  """Look up a session, raising 404 if not found or mismatched."""
  with _sessions_lock:
    session = _sessions.get(session_id)
  if session is None or session.project_id != project_id:
    raise HTTPException(status_code=404, detail='Session not found')
  return session


def _get_latest_mtime(project_dir: str, project_id: str) -> float:
  """Get the most recent modification time of any file in project_dir.

  Uses caching to avoid repeated filesystem walks on every poll (10x/sec).
  Cache is refreshed every MTIME_CACHE_TTL seconds.

  Used to detect when Claude creates or modifies files so the frontend
  can auto-refresh the file tree.
  """
  now = time.time()

  # Check cache first
  with _mtime_cache_lock:
    cached = _mtime_cache.get(project_id)
    if cached and (now - cached[1]) < MTIME_CACHE_TTL:
      return cached[0]

  # Cache miss - do the walk
  latest = 0.0
  try:
    for root, dirs, files in os.walk(project_dir):
      # Skip hidden directories
      dirs[:] = [d for d in dirs if not d.startswith('.')]
      for f in files:
        if f.startswith('.'):
          continue
        path = os.path.join(root, f)
        try:
          mtime = os.path.getmtime(path)
          if mtime > latest:
            latest = mtime
        except OSError:
          pass
  except Exception:
    pass

  # Update cache
  with _mtime_cache_lock:
    _mtime_cache[project_id] = (latest, now)

  return latest


@router.post('/projects/{project_id}/pty/{session_id}/output')
async def poll_output(project_id: str, session_id: str):
  """Drain buffered PTY output (base64-encoded).

  Thread-safe with output_lock to prevent race conditions with reader thread.
  """
  session = _get_session(project_id, session_id)
  session.last_activity = time.time()

  # Drain all buffered chunks (thread-safe)
  chunks: list[bytes] = []
  with session.output_lock:
    while session.output_buffer:
      try:
        chunks.append(session.output_buffer.popleft())
      except IndexError:
        break

  output = b''.join(chunks)
  encoded = base64.b64encode(output).decode('ascii') if output else ''

  result: dict = {'output': encoded}
  if not session.alive:
    result['exited'] = True

  # Add file modification timestamp for auto-refresh (cached to avoid repeated walks)
  project_dir = ensure_project_directory(session.project_id)
  result['files_modified_at'] = _get_latest_mtime(str(project_dir), session.project_id)

  return result


@router.post('/projects/{project_id}/pty/{session_id}/input')
async def send_input(project_id: str, session_id: str, body: InputRequest):
  """Send keystrokes (base64-encoded) to the PTY."""
  session = _get_session(project_id, session_id)
  session.last_activity = time.time()

  try:
    raw = base64.b64decode(body.data)
    os.write(session.master_fd, raw)
  except OSError as e:
    raise HTTPException(status_code=500, detail=f'Write failed: {e}')

  return {'status': 'ok'}


@router.post('/projects/{project_id}/pty/{session_id}/resize')
async def resize_terminal(project_id: str, session_id: str, body: ResizeRequest):
  """Resize the PTY window."""
  session = _get_session(project_id, session_id)
  session.last_activity = time.time()

  try:
    _set_winsize(session.master_fd, body.rows, body.cols)
  except OSError as e:
    raise HTTPException(status_code=500, detail=f'Resize failed: {e}')

  return {'status': 'ok'}


@router.delete('/projects/{project_id}/pty/{session_id}')
async def kill_session(project_id: str, session_id: str):
  """Kill a PTY session and clean up resources."""
  # Verify ownership before killing
  with _sessions_lock:
    session = _sessions.get(session_id)
  if session is None or session.project_id != project_id:
    raise HTTPException(status_code=404, detail='Session not found')

  _kill_session(session_id)
  return {'status': 'killed'}


@router.post('/projects/{project_id}/pty/{session_id}/terminate')
async def terminate_session(project_id: str, session_id: str):
  """Terminate PTY session. Called via sendBeacon on page unload.

  Unlike the DELETE endpoint, this returns success even if session not found
  (since sendBeacon can't handle errors and the session may already be gone).
  """
  with _sessions_lock:
    session = _sessions.get(session_id)
  if session is None or session.project_id != project_id:
    return {'status': 'not_found'}
  _kill_session(session_id)
  return {'status': 'terminated'}
