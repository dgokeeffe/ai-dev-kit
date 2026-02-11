"""FastAPI application for the Vibe Coding Workshop.

Provides:
  - WebSocket endpoint for real-time terminal I/O (direct PTY bridge).
  - REST endpoints for session CRUD, user identity, and health.
  - Static file serving for the React frontend (production mode).
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .claude_setup import (
    get_available_skills,
    prepare_session_environment,
)
from .session_manager import SessionManager

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

manager = SessionManager()

# Resolve skills directory: local skills/ first, then monorepo sibling
_APP_ROOT = Path(__file__).parent.parent
_SKILLS_DIRS = [
    _APP_ROOT / "skills",
    _APP_ROOT.parent / "databricks-skills",
]
SKILLS_DIR: Path | None = next((d for d in _SKILLS_DIRS if d.exists()), None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start cleanup loop on startup, stop all sessions on shutdown."""
    manager.start_cleanup_loop()
    if SKILLS_DIR:
        logger.info("Skills directory: %s", SKILLS_DIR)
    else:
        logger.warning("No skills directory found")
    yield
    manager.stop_all()


app = FastAPI(title="Vibe Coding Workshop", lifespan=lifespan)

# CORS — allow the hub frontend (different Databricks App) to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_user_email(
    request: Request | None = None, websocket: WebSocket | None = None
) -> str:
    """Extract user email from Databricks proxy headers."""
    headers = request.headers if request else websocket.headers  # type: ignore[union-attr]
    email = headers.get("x-forwarded-user", "")
    if not email:
        env = os.getenv("ENV", "development")
        if env == "development":
            return "dev-user@local"
        return ""
    return email


def _get_databricks_token(
    request: Request | None = None, websocket: WebSocket | None = None
) -> str:
    """Resolve a Databricks access token.

    Priority:
      1. X-Forwarded-Access-Token header (per-user, from Databricks proxy)
      2. PAT fallback from app secrets (shared, for debugging only)
      3. DATABRICKS_TOKEN env var (local development)
    """
    headers = request.headers if request else websocket.headers  # type: ignore[union-attr]

    # 1. Per-user token from Databricks proxy
    token = headers.get("x-forwarded-access-token")
    if token:
        return token

    # 2. PAT fallback (opt-in via USE_PAT_FALLBACK=1 in app.yaml)
    if os.getenv("USE_PAT_FALLBACK", "").lower() in ("1", "true", "yes"):
        pat = os.getenv("DATABRICKS_TOKEN")
        if pat:
            logger.warning(
                "Using PAT fallback (USE_PAT_FALLBACK=1). For debugging only."
            )
            return pat

    # 3. Local development fallback
    return os.getenv("DATABRICKS_TOKEN", "")


# ---------------------------------------------------------------------------
# Health / Status
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "workshop-worker"}


@app.get("/api/status")
async def status():
    return manager.get_status()


# ---------------------------------------------------------------------------
# User identity
# ---------------------------------------------------------------------------


@app.get("/api/me")
async def me(request: Request):
    email = _get_user_email(request=request)
    if not email:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    return {"email": email}


# ---------------------------------------------------------------------------
# Session CRUD
# ---------------------------------------------------------------------------


@app.post("/api/sessions")
async def create_session(request: Request):
    """Create a new Claude Code session for the current user.

    Body:
      session_name: str - friendly name
      workspace_dir: str (optional) - absolute path to use as workspace
                     (personal mode: point at a real repo)
      initial_prompt: str (optional) - text to inject after session starts
    """
    email = _get_user_email(request=request)
    if not email:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})

    body = await request.json()
    session_name = body.get("session_name", "default")
    custom_workspace = body.get("workspace_dir")
    initial_prompt = body.get("initial_prompt")

    # Prepare the session environment before spawning PTY
    host = os.getenv("DATABRICKS_HOST", "")
    token = _get_databricks_token(request=request)
    home_dir = os.environ.get("HOME", "/tmp/workshop-home")

    try:
        session = manager.create_session(
            email, session_name, workspace_override=custom_workspace
        )
    except RuntimeError as e:
        return JSONResponse(status_code=503, content={"error": str(e)})

    # Run environment setup (skip for custom workspaces — user's repo)
    if not custom_workspace:
        try:
            prepare_session_environment(
                home_dir=home_dir,
                session_workspace=session.workspace_dir,
                host=host,
                token=token,
                user_email=email,
                session_name=session_name,
                skills_source=SKILLS_DIR,
            )
        except Exception as e:
            logger.error("Session env setup failed (non-fatal): %s", e)

    # Inject initial prompt after a short delay (let Claude Code start up)
    if initial_prompt:
        import threading

        def _delayed_send():
            time.sleep(3)  # wait for Claude Code to be ready
            text = (
                initial_prompt
                if initial_prompt.endswith("\n")
                else initial_prompt + "\n"
            )
            manager.write_to_session(session.session_id, text.encode())
            logger.info(
                "Sent initial prompt to session %s (%d chars)",
                session.session_id,
                len(text),
            )

        threading.Thread(target=_delayed_send, daemon=True).start()

    return session.to_dict()


@app.get("/api/sessions")
async def list_sessions(request: Request):
    """List all sessions for the current user."""
    email = _get_user_email(request=request)
    if not email:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    sessions = manager.get_user_sessions(email)
    return [s.to_dict() for s in sessions]


@app.delete("/api/sessions/{session_id}")
async def delete_session(request: Request, session_id: str):
    """Stop and remove a session."""
    email = _get_user_email(request=request)
    session = manager.get_session(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    if session.user_email != email:
        return JSONResponse(status_code=403, content={"error": "Not your session"})
    manager.stop_session(session_id)
    return {"status": "stopped"}


@app.post("/api/sessions/{session_id}/resize")
async def resize_session(request: Request, session_id: str):
    """Resize the terminal for a session."""
    email = _get_user_email(request=request)
    session = manager.get_session(session_id)
    if not session or session.user_email != email:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    body = await request.json()
    manager.resize_session(session_id, body.get("rows", 24), body.get("cols", 80))
    return {"status": "resized"}


@app.post("/api/sessions/{session_id}/send")
async def send_to_session(request: Request, session_id: str):
    """Send text/command to a running session's PTY.

    Body: { "text": "string to send" }
    Appends a newline unless the text already ends with one.
    Useful for fire-and-forget task injection.
    """
    email = _get_user_email(request=request)
    session = manager.get_session(session_id)
    if not session or session.user_email != email:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    if not session.alive:
        return JSONResponse(status_code=409, content={"error": "Session is not alive"})
    body = await request.json()
    text = body.get("text", "")
    if not text:
        return JSONResponse(status_code=400, content={"error": "No text provided"})
    # Ensure newline so the command actually executes
    if not text.endswith("\n"):
        text += "\n"
    manager.write_to_session(session_id, text.encode())
    return {"status": "sent", "bytes": len(text)}


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------


@app.get("/api/skills")
async def list_skills():
    """List available workshop skills."""
    if SKILLS_DIR:
        return get_available_skills(SKILLS_DIR)
    return []


# ---------------------------------------------------------------------------
# WebSocket terminal
# ---------------------------------------------------------------------------


@app.websocket("/ws/session/{session_id}")
async def ws_terminal(websocket: WebSocket, session_id: str):
    """Real-time terminal I/O over WebSocket.

    Bridges the browser's xterm.js directly to the Claude Code PTY.
    On connect, replays the output buffer so the user sees what happened
    while disconnected.
    """
    email = _get_user_email(websocket=websocket)
    if not email:
        await websocket.close(code=4001, reason="Not authenticated")
        return

    session = manager.get_session(session_id)
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return
    if session.user_email != email:
        await websocket.close(code=4003, reason="Not your session")
        return
    if not session.alive:
        await websocket.close(code=4005, reason="Session is no longer alive")
        return

    await websocket.accept()
    session.touch()

    # Replay output buffer for reconnection
    try:
        for chunk in list(session.output_buffer):
            await websocket.send_bytes(chunk)
    except Exception:
        return

    # Subscribe to the session's output stream (reader thread broadcasts)
    queue = session.subscribe()

    async def forward_pty_to_ws():
        """Receive data from the reader thread's queue and send to WebSocket."""
        while True:
            data = await queue.get()
            if data is None:
                break  # Session ended
            try:
                await websocket.send_bytes(data)
            except Exception:
                break

    async def forward_ws_to_pty():
        """Read from WebSocket and write to PTY."""
        try:
            while True:
                data = await websocket.receive()
                if "bytes" in data and data["bytes"]:
                    manager.write_to_session(session_id, data["bytes"])
                elif "text" in data and data["text"]:
                    manager.write_to_session(session_id, data["text"].encode())
                elif data.get("type") == "websocket.disconnect":
                    break
        except WebSocketDisconnect:
            pass

    try:
        # Run both directions concurrently
        done, pending = await asyncio.wait(
            [
                asyncio.create_task(forward_pty_to_ws()),
                asyncio.create_task(forward_ws_to_pty()),
            ],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    finally:
        session.unsubscribe(queue)
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Static file serving (production)
# ---------------------------------------------------------------------------

_STATIC_DIR = _APP_ROOT / "client" / "dist"
if os.getenv("SERVE_STATIC", "true").lower() == "true" and _STATIC_DIR.exists():
    from starlette.responses import FileResponse

    # Mount assets directory first (higher priority than catch-all)
    _ASSETS_DIR = _STATIC_DIR / "assets"
    if _ASSETS_DIR.exists():
        app.mount("/assets", StaticFiles(directory=_ASSETS_DIR), name="assets")

    # SPA catch-all: serve files if they exist, otherwise index.html
    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        # Don't serve for API or WebSocket paths
        if full_path.startswith(("api/", "ws/")):
            return JSONResponse(status_code=404, content={"error": "Not found"})
        file_path = _STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_STATIC_DIR / "index.html")

    logger.info("Serving static files from %s", _STATIC_DIR)
