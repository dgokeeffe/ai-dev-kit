# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Databricks Builder App - a full-stack web application providing a Claude Code agent interface with integrated Databricks tools. Users chat with Claude through a web UI, and the agent can execute SQL queries, manage pipelines, upload files, and more on their Databricks workspace.

**Key innovation**: Implements a workaround for claude-agent-sdk issue #462 by running the agent in a fresh event loop in a separate thread with proper contextvars propagation for Databricks authentication. See `EVENT_LOOP_FIX.md` for details.

## Development commands

### Backend (Python/FastAPI)
```bash
# Start backend server with hot reload
uvicorn server.app:app --reload --port 8000 --reload-dir server

# Lint and format
ruff check server/
ruff format server/

# Database migrations
alembic upgrade head                              # Run migrations
alembic revision --autogenerate -m "description"  # Create migration
```

### Frontend (React/TypeScript)
```bash
cd client
npm run dev      # Start Vite dev server on port 3000
npm run build    # Production build (tsc + vite build)
npm run lint     # ESLint check
```

### Full stack development
```bash
./scripts/start_dev.sh  # Starts both backend and frontend
```

### CI checks (run before PRs)
```bash
uvx ruff check server/
uvx ruff format --check server/
```

## Architecture

```
React Frontend (port 3000) <--SSE--> FastAPI Backend (port 8000) <--> Claude Agent SDK <--> Databricks MCP Server <--> Databricks Workspace
```

### Backend structure (`server/`)
- `app.py` - FastAPI application entry point with CORS and router mounting
- `routers/` - API endpoints (agent, projects, conversations, config, clusters, warehouses, skills, files, deploy)
- `services/` - Business logic:
  - `agent.py` - Claude Code session management with fresh event loop fix
  - `databricks_tools.py` - MCP tool loading and async handoff
  - `user.py` - Authentication (extracts credentials from headers or env vars)
  - `system_prompt.py` - Dynamic system prompt generation
  - `backup_manager.py` - Project backup/restore to PostgreSQL
- `db/` - SQLAlchemy models (Project, Conversation, Message, Execution, ProjectBackup) and database session management

### Frontend structure (`client/src/`)
- `pages/` - Main pages (HomePage, ProjectPage, DocPage)
- `components/` - UI components including CodeMirror-based editor
- `contexts/` - React contexts (UserContext, ProjectsContext)
- `lib/` - Utilities (api.ts for HTTP calls, types.ts)

### Authentication flow
- **Production (Databricks Apps)**: Uses `X-Forwarded-User` and `X-Forwarded-Access-Token` headers
- **Development**: Falls back to `DATABRICKS_HOST` and `DATABRICKS_TOKEN` from `.env.local`
- Auth is set via `databricks_tools_core.auth.set_databricks_auth()` using contextvars for per-request isolation

### MCP tools integration
Tools from databricks-mcp-server are exposed as `mcp__databricks__<tool_name>`:
- `execute_sql`, `execute_sql_multi` - SQL execution
- `create_or_update_pipeline`, `start_update` - Pipeline management
- `upload_file`, `upload_folder` - File operations
- `run_python_file_on_databricks`, `execute_databricks_command` - Cluster execution

### Skills system
Skills are markdown files providing specialized guidance. Loaded from `../databricks-skills/` and copied to project `.claude/skills/`. Agent invokes via `Skill` tool.

### Project persistence
- Projects stored in `./projects/<project-uuid>/`
- Auto-backup to PostgreSQL every 10 minutes
- Missing projects auto-restored from backup on access

## Code style

### Python
- Uses ruff for linting and formatting
- 2-space indentation, single quotes, 100 char line length
- Google-style docstrings
- Target Python 3.11+

### TypeScript/React
- Vite + React 18 + TypeScript
- Tailwind CSS for styling
- CodeMirror for code editing
- Sonner for toast notifications

## Key patterns

### Event loop fix for claude-agent-sdk
The agent runs in a separate thread with `asyncio.new_event_loop()` because claude-agent-sdk's subprocess transport fails in FastAPI/uvicorn contexts. Context variables are copied before spawning the thread to preserve Databricks auth. See `server/services/agent.py`.

### SSE streaming
Agent responses stream via Server-Sent Events from `/api/agent/stream_progress/{execution_id}`. Events include text, thinking, tool_use, and tool_result.

### Async handoff
Long-running operations (>10s) use background execution with operation IDs for status polling.

## Related packages

This app depends on sibling packages in the monorepo:
- `databricks-tools-core` - Core MCP functionality and auth
- `databricks-mcp-server` - MCP server exposing Databricks tools
- `databricks-skills` - Skill definitions for Databricks development

Install sibling packages in dev: `uv pip install -e ../databricks-tools-core -e ../databricks-mcp-server`
