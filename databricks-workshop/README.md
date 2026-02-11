# Vibe Coding Workshop

A web platform that gives workshop participants concurrent Claude Code terminal sessions, each pre-loaded with Databricks skills, for building data pipelines and apps entirely through AI pair programming.

## Architecture

```
Browser → Hub App (React SPA) → Worker App(s) (FastAPI + WebSocket + PTY)
                                      │
                                      ├── Claude Code Session 1
                                      ├── Claude Code Session 2
                                      └── Claude Code Session N
```

- **Hub/Frontend**: React SPA with landing page and multi-tab terminal dashboard
- **Workers**: FastAPI servers managing Claude Code PTY sessions with WebSocket I/O
- **Authentication**: Databricks Apps proxy (`X-Forwarded-User`)
- **Claude Code**: Authenticated via Databricks Foundation Model API (FMAPI)
- **Skills**: Pre-installed ai-dev-kit skills for pipelines, apps, and deployment

## Quick Start (Single Instance)

### Prerequisites

- Databricks CLI authenticated (`databricks auth login`)
- Git repo pushed to GitHub

### Deploy

```bash
# 1. Push code
git add . && git commit -m "Workshop deploy" && git push

# 2. Create the app via bundle (provisions app + secret resource)
cd databricks-workshop
databricks bundle deploy -t dev

# 3. Create the secret scope and store a PAT for Claude Code FMAPI
databricks secrets create-scope workshop-pat
databricks tokens create --comment "Workshop Claude API" --lifetime-seconds 7776000 --output json
# Copy the token_value from the output, then:
databricks secrets put-secret workshop-pat claude-api-token --string-value "<token>"

# 4. Deploy from git
./scripts/deploy-workshop.sh --prefix vibe --workers 1
```

### Local Development

```bash
# Terminal 1: Backend
cd databricks-workshop
pip install -r server/requirements.txt
export DATABRICKS_HOST="https://your-workspace.cloud.databricks.com"
export DATABRICKS_TOKEN="dapi..."     # local only; never in app.yaml
export CLAUDE_API_TOKEN="dapi..."     # or same token for FMAPI
uvicorn server.app:app --reload --port 8000

# Terminal 2: Frontend
cd databricks-workshop/client
npm install
npm run dev
```

## Secrets Management

Follows [Databricks Apps secrets best practices](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/secrets):

- **Never hardcode tokens** in `app.yaml` or environment variables.
- The Claude API token is stored in a **Databricks secret scope** (`workshop-pat` / `claude-api-token`) and added as an **app resource** named `claude-pat`.
- `app.yaml` references it via `valueFrom: claude-pat` — the runtime injects it as `CLAUDE_API_TOKEN` without exposing the raw value.
- The deploy script automates this: `--token <value>` creates the scope, stores the secret, and attaches the resource to each worker app.
- **Per-user auth** uses `X-Forwarded-Access-Token` from the Databricks proxy (no shared secret needed for user-scoped operations).
- **PAT fallback** (optional, debugging only): uncomment `USE_PAT_FALLBACK` and `DATABRICKS_TOKEN` in `app.yaml` for environments where the proxy doesn't forward user tokens.
- PAT lifetime is 90 days by default; rotate before expiry.

## Full Workshop Deployment (300 Sessions)

For ~100 users with 3 sessions each:

```bash
./scripts/deploy-workshop.sh \
  --prefix vibe \
  --workers 10 \
  --token "dapi..." \
  --branch main
```

This creates 10 worker apps (`vibe-worker-1` through `vibe-worker-10`), each handling up to 50 sessions.

### Scaling Math

| Metric                         | Value  |
| ------------------------------ | ------ |
| Users                          | ~100   |
| Sessions per user              | 3      |
| Total sessions                 | ~300   |
| Claude Code memory per session | ~150MB |
| Sessions per worker            | ~30    |
| Workers needed                 | ~10    |

### Teardown

```bash
./scripts/deploy-workshop.sh --prefix vibe --workers 10 --destroy
```

## Workshop Challenge

Participants use their 3 Claude Code sessions to:

1. **Data Pipeline** — Build a Lakeflow Declarative Pipeline (bronze → silver → gold)
2. **Analytics App** — Create a Dash/Streamlit app querying pipeline output
3. **AI App** — Build an app using Databricks Foundation Model API

## Pre-installed Skills

| Skill | Purpose |
|-------|---------|
| `spark-declarative-pipelines` | Lakeflow pipeline patterns |
| `databricks-app-python` | Dash/Streamlit/Flask app scaffolding |
| `databricks-app-git-deploy` | Git-based app deployment |
| `synthetic-data-generation` | Test data generation with Faker |
| `asset-bundles` | Databricks Asset Bundle configuration |
| `model-serving` | Foundation Model API integration |

## Project Structure

```
databricks-workshop/
├── app.yaml                    # Databricks App config
├── databricks.yml              # Asset Bundle definition
├── scripts/
│   ├── entrypoint.sh           # App startup (install deps + run)
│   ├── install.sh              # Install Claude Code, Databricks CLI
│   └── deploy-workshop.sh      # N-instance deployment orchestrator
├── server/
│   ├── app.py                  # FastAPI (WebSocket + REST)
│   ├── session_manager.py      # Multi-session PTY management
│   ├── claude_setup.py         # FMAPI auth + environment setup
│   └── requirements.txt
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/              # Landing + Dashboard
│   │   ├── components/         # Terminal, SessionCard, Modal
│   │   └── lib/                # API client, WebSocket manager
│   ├── package.json
│   └── vite.config.ts
└── skills/                     # Workshop skills (copied into sessions)
```

## Key Design Decisions

- **WebSocket terminal** (not HTTP polling): Eliminates input lag. Proven to work on Databricks Apps via the code-server project.
- **Direct PTY bridge**: WebSocket connects directly to the PTY file descriptor — no intermediate HTTP server per session.
- **Output ring buffer**: Each session buffers ~200KB of output for seamless reconnection.
- **Multi-instance scaling**: Deploy N identical worker apps; users are routed via consistent hashing on email.
