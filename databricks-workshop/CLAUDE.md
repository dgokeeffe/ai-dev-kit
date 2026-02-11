# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Vibe Coding Workshop - a web platform that gives workshop participants concurrent Claude Code terminal sessions pre-loaded with Databricks skills. Enables AI pair programming for building data pipelines, analytics apps, and AI applications via the Claude Code CLI.

## Architecture

```
Browser → Hub App (React SPA) → Worker App(s) (FastAPI + WebSocket + PTY)
                                      ├── Claude Code Session 1
                                      ├── Claude Code Session 2
                                      └── Claude Code Session N
```

- **Frontend** (`client/`): React 18 SPA with xterm.js terminal emulation, Vite 6, TailwindCSS, TypeScript
- **Backend** (`server/`): FastAPI with direct PTY bridge (`os.fork()` + `pty.openpty()`), WebSocket terminal I/O
- **Skills** (`skills/`): Pre-installed Claude Code skills copied into each session (pipelines, apps, data gen, model serving, asset bundles)
- **Deployment** (`scripts/`): Entrypoint, installer, and N-instance deployment orchestrator for Databricks Apps
- **Config**: `app.yaml` (Databricks App manifest), `databricks.yml` (Asset Bundle definition)

### Key backend patterns

- **Ring buffer** (200KB deque) per session for reconnection replay
- **Pub/sub broadcast**: single PTY reader thread pushes to all WebSocket subscribers via asyncio.Queue
- **Consistent hashing**: `hash(user_email) % num_workers` for multi-instance user routing
- **Idle cleanup**: background loop terminates sessions after 60 min idle
- **Auth**: Databricks Apps proxy headers (`X-Forwarded-User`, `X-Forwarded-Access-Token`), PAT fallback for debug

### Key frontend patterns

- **xterm.js + FitAddon** for responsive terminal sizing
- **WsManager** handles WebSocket reconnect with exponential backoff
- **Vite manual chunking** splits xterm into separate vendor bundle

## Development commands

### Backend (local)

```bash
pip install -r server/requirements.txt
DATABRICKS_HOST="https://your-workspace.cloud.databricks.com" \
DATABRICKS_TOKEN="dapi..." \
CLAUDE_API_TOKEN="dapi..." \
uvicorn server.app:app --reload --port 8000
```

### Frontend (local)

```bash
cd client && npm install
npm run dev          # Vite dev server at localhost:5173 (proxies /api and /ws to :8000)
npm run build        # Production build to client/dist
```

### Deployment

```bash
# Single instance (dev)
databricks bundle deploy -t dev

# Multi-worker workshop (scales to ~300 sessions across 10 workers)
./scripts/deploy-workshop.sh --prefix vibe --workers 10 --token "dapi..."

# Teardown
./scripts/deploy-workshop.sh --prefix vibe --workers 10 --destroy
```

## Key files

| File | Purpose |
|------|---------|
| `server/app.py` | FastAPI routes, WebSocket bridge, static serving |
| `server/session_manager.py` | PTY session lifecycle, ring buffer, pub/sub, idle cleanup |
| `server/claude_setup.py` | Per-session env setup (Claude settings, Databricks config, git, skills) |
| `client/src/pages/DashboardPage.tsx` | Multi-session dashboard with auto-create |
| `client/src/components/Terminal.tsx` | xterm.js WebSocket bridge |
| `client/src/lib/api.ts` | REST client with consistent hashing for multi-instance routing |
| `client/src/lib/websocket.ts` | WsManager with auto-reconnect |
| `scripts/deploy-workshop.sh` | N-instance deployment orchestrator |
| `scripts/install.sh` | Installs Node.js 22, Claude Code, Databricks CLI, GitHub CLI, helper scripts |

## Session workspace layout

Sessions live at `workspaces/<user_hash>/<session_name>/`. Each session gets:
- `~/.claude/settings.json` - Claude Code config with FMAPI auth
- `~/.databrickscfg` - Databricks profile
- Git identity from Databricks user info
- Copied skills from `skills/` directory
- A workshop-specific `CLAUDE.md`

## No test or lint configuration

There are no pytest, jest, or linting configs in the repo. Testing is manual via browser + terminal.
