# Task: Fix Claude Code Terminal in Existing App

## Objective

Get Claude Code terminal working in the deployed Databricks App using the existing Python backend. The terminal connects but Claude CLI fails to spawn because `node-pty` or proper Node.js integration is missing.

## Current Problem

1. WebSocket connects to `/api/projects/{id}/claude-terminal`
2. PTY tries to spawn `claude --dangerously-skip-permissions`
3. Claude CLI exists (`node_modules/.bin/claude`) but spawning fails
4. Connection closes immediately

## Strategy

Instead of spawning Claude CLI via PTY, use the existing `claude-agent-sdk` Python SDK which is already installed and working. Create a WebSocket endpoint that streams the agent responses to xterm.js formatted output.

---

## Task 1: Create WebSocket agent terminal endpoint

**File:** `server/routers/agent_terminal.py`

Create a new WebSocket endpoint that uses `claude-agent-sdk` to handle terminal-like interactions.

```python
"""WebSocket endpoint for Claude agent terminal.

Uses claude-agent-sdk to provide a terminal-like Claude experience
without requiring the Node.js CLI.
"""

import asyncio
import json
import logging
import os
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services.agent import stream_agent_response
from ..services.backup_manager import ensure_project_directory
from ..services.storage import ProjectStorage

logger = logging.getLogger(__name__)
router = APIRouter()


def format_for_terminal(event: dict) -> str:
    """Format agent event as terminal output with ANSI colors."""
    event_type = event.get('type', '')

    if event_type == 'text':
        return event.get('text', '')
    elif event_type == 'text_delta':
        return event.get('text', '')
    elif event_type == 'thinking':
        # Gray color for thinking
        thinking = event.get('thinking', '')
        return f'\x1b[90m{thinking}\x1b[0m'
    elif event_type == 'thinking_delta':
        thinking = event.get('thinking', '')
        return f'\x1b[90m{thinking}\x1b[0m'
    elif event_type == 'tool_use':
        tool_name = event.get('tool_name', 'unknown')
        tool_input = event.get('tool_input', {})
        # Cyan for tool use
        return f'\n\x1b[36m⚡ {tool_name}\x1b[0m\n'
    elif event_type == 'tool_result':
        content = event.get('content', '')
        is_error = event.get('is_error', False)
        if is_error:
            return f'\x1b[31m{content}\x1b[0m\n'
        # Truncate long results
        if len(content) > 500:
            content = content[:500] + '...(truncated)'
        return f'\x1b[90m{content}\x1b[0m\n'
    elif event_type == 'result':
        session_id = event.get('session_id', '')
        return f'\n\x1b[32m✓ Complete (session: {session_id[:8]}...)\x1b[0m\n'
    elif event_type == 'error':
        error = event.get('error', 'Unknown error')
        return f'\n\x1b[31m✗ Error: {error}\x1b[0m\n'
    elif event_type == 'keepalive':
        return ''  # Silent keepalive

    return ''


@router.websocket('/projects/{project_id}/agent-terminal')
async def agent_terminal(websocket: WebSocket, project_id: str):
    """WebSocket endpoint for Claude agent terminal.

    Provides a terminal-like interface using claude-agent-sdk.
    """
    await websocket.accept()
    logger.info(f'Agent terminal connected for project {project_id}')

    # Verify project access
    user_email = websocket.headers.get('x-forwarded-user')
    if not user_email:
        if os.getenv('ENV', 'development') == 'development':
            user_email = 'dev-user@local'
        else:
            await websocket.send_json({'type': 'error', 'message': 'Authentication required'})
            await websocket.close(code=4001)
            return

    storage = ProjectStorage(user_email)
    project = await storage.get(project_id)
    if not project:
        await websocket.send_json({'type': 'error', 'message': 'Project not found'})
        await websocket.close(code=4004)
        return

    project_dir = ensure_project_directory(project_id)

    # Get Databricks credentials
    host = websocket.headers.get('x-forwarded-host')
    token = websocket.headers.get('x-forwarded-access-token')

    if not host:
        host = os.getenv('DATABRICKS_HOST')
        token = os.getenv('DATABRICKS_TOKEN')

    if host and not host.startswith('http'):
        host = f'https://{host}'

    # Send connected message
    await websocket.send_json({'type': 'connected', 'project_dir': str(project_dir)})

    # Welcome message
    welcome = (
        '\x1b[1;34m╭─────────────────────────────────────────────────────╮\x1b[0m\r\n'
        '\x1b[1;34m│\x1b[0m  \x1b[1;33mClaude Code Agent\x1b[0m                                  \x1b[1;34m│\x1b[0m\r\n'
        '\x1b[1;34m│\x1b[0m  Type your request and press Enter                  \x1b[1;34m│\x1b[0m\r\n'
        '\x1b[1;34m╰─────────────────────────────────────────────────────╯\x1b[0m\r\n'
        '\r\n'
    )
    await websocket.send_bytes(welcome.encode())

    # Session state
    session_id: Optional[str] = None
    current_input = ''
    is_processing = False
    cancel_requested = False

    async def process_message(message: str):
        nonlocal session_id, is_processing, cancel_requested

        is_processing = True
        cancel_requested = False

        # Show prompt echo
        await websocket.send_bytes(f'\x1b[1;32m❯\x1b[0m {message}\r\n\r\n'.encode())

        try:
            async for event in stream_agent_response(
                project_id=project_id,
                message=message,
                session_id=session_id,
                databricks_host=host,
                databricks_token=token,
                is_cancelled_fn=lambda: cancel_requested,
            ):
                if cancel_requested:
                    await websocket.send_bytes('\r\n\x1b[33m⚠ Cancelled\x1b[0m\r\n'.encode())
                    break

                # Update session ID from result
                if event.get('type') == 'result':
                    session_id = event.get('session_id', session_id)

                # Format and send
                output = format_for_terminal(event)
                if output:
                    # Convert newlines to CRLF for terminal
                    output = output.replace('\n', '\r\n')
                    await websocket.send_bytes(output.encode())

        except Exception as e:
            logger.exception(f'Error processing message: {e}')
            await websocket.send_bytes(f'\r\n\x1b[31m✗ Error: {e}\x1b[0m\r\n'.encode())

        finally:
            is_processing = False
            # Show new prompt
            await websocket.send_bytes('\r\n\x1b[1;32m❯\x1b[0m '.encode())

    # Show initial prompt
    await websocket.send_bytes('\x1b[1;32m❯\x1b[0m '.encode())

    try:
        while True:
            data = await websocket.receive()

            if data['type'] == 'websocket.disconnect':
                break

            if 'bytes' in data:
                # Terminal input
                input_bytes = data['bytes']
                input_str = input_bytes.decode('utf-8', errors='ignore')

                for char in input_str:
                    if char == '\r' or char == '\n':
                        # Enter pressed
                        if current_input.strip() and not is_processing:
                            message = current_input.strip()
                            current_input = ''
                            await websocket.send_bytes('\r\n'.encode())
                            asyncio.create_task(process_message(message))
                        elif is_processing:
                            # Ignore enter while processing
                            pass
                        else:
                            # Empty input, just show new prompt
                            await websocket.send_bytes('\r\n\x1b[1;32m❯\x1b[0m '.encode())

                    elif char == '\x03':
                        # Ctrl+C
                        if is_processing:
                            cancel_requested = True
                            await websocket.send_bytes('^C'.encode())
                        else:
                            current_input = ''
                            await websocket.send_bytes('^C\r\n\x1b[1;32m❯\x1b[0m '.encode())

                    elif char == '\x7f' or char == '\x08':
                        # Backspace
                        if current_input and not is_processing:
                            current_input = current_input[:-1]
                            # Move cursor back, clear char, move back again
                            await websocket.send_bytes('\x08 \x08'.encode())

                    elif char >= ' ' and not is_processing:
                        # Regular character
                        current_input += char
                        await websocket.send_bytes(char.encode())

            elif 'text' in data:
                # JSON control message
                try:
                    msg = json.loads(data['text'])
                    if msg.get('type') == 'resize':
                        # Handle resize if needed
                        pass
                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception(f'Error in agent terminal: {e}')

    finally:
        logger.info(f'Agent terminal disconnected for project {project_id}')
```

**Completion criteria:**
- [ ] File created at `server/routers/agent_terminal.py`
- [ ] No syntax errors
- [ ] Imports resolve correctly

---

## Task 2: Register the new router

**File:** `server/routers/__init__.py`

Add the new agent_terminal router to exports.

```python
from .agent_terminal import router as agent_terminal_router
```

And add to `__all__`:
```python
'agent_terminal_router',
```

**File:** `server/app.py`

Import and register:
```python
from .routers import ..., agent_terminal_router

app.include_router(agent_terminal_router, prefix=API_PREFIX, tags=['agent-terminal'])
```

**Completion criteria:**
- [ ] Router imported in `__init__.py`
- [ ] Router registered in `app.py`
- [ ] No import errors on startup

---

## Task 3: Update frontend to use agent terminal

**File:** `client/src/components/terminal/ClaudeTerminal.tsx`

Change the WebSocket URL from `claude-terminal` to `agent-terminal`:

```typescript
// Change this line:
const wsUrl = `${protocol}//${window.location.host}/api/projects/${projectId}/claude-terminal`;

// To:
const wsUrl = `${protocol}//${window.location.host}/api/projects/${projectId}/agent-terminal`;
```

**Completion criteria:**
- [ ] WebSocket URL updated
- [ ] Frontend builds without errors: `cd client && npm run build`

---

## Task 4: Test locally

Run the app locally and verify:

```bash
# Terminal 1: Backend
cd /Users/david.okeeffe/Repos/ai-dev-kit/databricks-builder-app
uvicorn server.app:app --reload --port 8000

# Terminal 2: Frontend
cd /Users/david.okeeffe/Repos/ai-dev-kit/databricks-builder-app/client
npm run dev
```

**Completion criteria:**
- [ ] Backend starts without errors
- [ ] Frontend starts without errors
- [ ] Can open http://localhost:3000
- [ ] Can create or open a project
- [ ] Claude terminal connects and shows prompt
- [ ] Can type a message and get a response

---

## Task 5: Deploy to Databricks

```bash
./scripts/deploy.sh databricks-builder-app
```

**Completion criteria:**
- [ ] Deployment succeeds
- [ ] App accessible at URL
- [ ] Claude terminal works in production

---

## Verification

When ALL of the following are true, output: `<promise>TERMINAL FIXED</promise>`

1. [ ] Backend starts without import/syntax errors
2. [ ] WebSocket endpoint `/api/projects/{id}/agent-terminal` responds
3. [ ] Frontend connects to agent terminal
4. [ ] User can type messages and see Claude responses
5. [ ] Tool use displays correctly (file reads, writes, etc.)
6. [ ] Ctrl+C cancels in-progress requests
7. [ ] Session persists across messages (conversation context maintained)
