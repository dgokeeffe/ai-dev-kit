# Task: Implement dual-app architecture for 150 concurrent users

## Objective

Create a dual-app deployment architecture where 2 Large Databricks Apps (each with ~12GB memory) can handle 150 concurrent Claude Code PTY sessions. Each app handles ~75 users via hash-based routing.

## Context

Read these files to understand the current architecture:
- `app.yaml` - Current single-app configuration
- `server/app.py` - FastAPI application entry point
- `server/routers/pty.py` - PTY session management
- `client/src/lib/api.ts` - Frontend API configuration

Also read `progress.txt` if it exists - it contains learnings from previous iterations.

## Background

**Resource constraints:**
- Large Databricks App: ~4 vCPU, ~12GB memory
- Each PTY session: ~100MB memory
- 150 users × 100MB = 15GB (exceeds single app)
- Solution: 2 apps × 75 users × 100MB = 7.5GB each (fits)

**Architecture:**
```
                    ┌─────────────────┐
                    │   User Browser  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Frontend App   │
                    │ (static files)  │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │   Hash-based routing        │
              │   hash(email) % 2           │
              └──────────────┬──────────────┘
                    ┌────────┴────────┐
           ┌────────▼────────┐ ┌──────▼──────────┐
           │  Backend App 1  │ │  Backend App 2  │
           │  (users 0-49%)  │ │  (users 50-100%)│
           └────────┬────────┘ └────────┬────────┘
                    └────────┬──────────┘
                    ┌────────▼────────┐
                    │   Lakebase DB   │
                    │    (shared)     │
                    └─────────────────┘
```

## Requirements

1. **Deployment configuration:**
   - `app.yaml.backend.template` - Backend-only app config (no static files)
   - `app.yaml.frontend.template` - Frontend-only app config (static files, routing logic)
   - `deploy-dual.sh` - Script to deploy both backends + frontend

2. **Backend changes:**
   - Backend apps serve API only (no static file serving)
   - Health endpoint at `/api/health` for monitoring
   - App name/instance identifier in logs for debugging

3. **Frontend routing:**
   - Determine backend URL based on hash of user email
   - Store backend assignment in localStorage for session affinity
   - Configurable backend URLs via environment variables

4. **Shared resources:**
   - Both backends connect to same Lakebase instance
   - Projects stored in shared database (already implemented)
   - PTY sessions are local to each backend (no sharing needed)

## Technical approach

### Frontend routing (`client/src/lib/api.ts`)

```typescript
// Backend URLs from environment or config
const BACKEND_URLS = [
  import.meta.env.VITE_BACKEND_1_URL || '/api',
  import.meta.env.VITE_BACKEND_2_URL || '/api',
];

function getBackendUrl(userEmail: string): string {
  // Check localStorage for existing assignment (session affinity)
  const cached = localStorage.getItem('backend_assignment');
  if (cached) {
    const { email, url } = JSON.parse(cached);
    if (email === userEmail) return url;
  }

  // Hash-based routing
  const hash = userEmail.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const backendIndex = hash % BACKEND_URLS.length;
  const url = BACKEND_URLS[backendIndex];

  // Cache assignment
  localStorage.setItem('backend_assignment', JSON.stringify({ email: userEmail, url }));
  return url;
}
```

### Backend health endpoint (`server/routers/health.py`)

```python
@router.get('/health')
async def health_check():
    return {
        'status': 'healthy',
        'app_instance': os.getenv('APP_INSTANCE', 'unknown'),
        'active_pty_sessions': len(_sessions),
    }
```

### Deployment script (`deploy-dual.sh`)

```bash
#!/bin/bash
# Deploy dual-app architecture

WORKSPACE_URL="${DATABRICKS_HOST}"
APP_PREFIX="${APP_PREFIX:-builder}"

# Deploy backend 1
databricks apps deploy "${APP_PREFIX}-backend-1" \
  --source-code-path . \
  --config app.yaml.backend.template \
  --env APP_INSTANCE=backend-1

# Deploy backend 2
databricks apps deploy "${APP_PREFIX}-backend-2" \
  --source-code-path . \
  --config app.yaml.backend.template \
  --env APP_INSTANCE=backend-2

# Deploy frontend (with backend URLs)
databricks apps deploy "${APP_PREFIX}-frontend" \
  --source-code-path ./client/out \
  --config app.yaml.frontend.template \
  --env VITE_BACKEND_1_URL="https://${APP_PREFIX}-backend-1.${WORKSPACE_URL#https://}" \
  --env VITE_BACKEND_2_URL="https://${APP_PREFIX}-backend-2.${WORKSPACE_URL#https://}"
```

## Gates

Run `bash gates.sh` to verify code quality:

| Gate | Command |
|------|---------|
| Lint | uvx ruff check . |
| Types | cd client && npx tsc --noEmit |
| Build | npm run build |

## Completion criteria

The task is COMPLETE only when:
- [ ] `bash gates.sh` exits with code 0
- [ ] `app.yaml.backend.template` exists with backend-only config
- [ ] `app.yaml.frontend.template` exists with frontend-only config
- [ ] `deploy-dual.sh` exists and is executable
- [ ] `client/src/lib/api.ts` has hash-based backend routing
- [ ] `server/routers/health.py` exists with health endpoint
- [ ] Health router is registered in `server/app.py`

Do NOT assess completion subjectively. Run `bash gates.sh` and check the exit code.

## Instructions

1. Read the context files listed above
2. Read `progress.txt` if it exists to learn from previous iterations
3. Create `server/routers/health.py` with health endpoint
4. Register health router in `server/app.py`
5. Modify `client/src/lib/api.ts` to support backend routing:
   - Add `getBackendUrl()` function
   - Update API calls to use routed URL for PTY endpoints
6. Create `app.yaml.backend.template` (API-only, no static files)
7. Create `app.yaml.frontend.template` (static files only)
8. Create `deploy-dual.sh` deployment script
9. Run `bash gates.sh` - all gates should pass
10. Commit working changes with clear messages
11. Append to `progress.txt` what you learned this iteration

When `bash gates.sh` exits 0 AND all deliverables are created, output:
<promise>TASK COMPLETE</promise>

CRITICAL RULES:
- Only output the promise AFTER running `bash gates.sh` and seeing it exit 0
- Do NOT output the promise based on your judgment alone - gates.sh must pass
- Do NOT lie or output a false promise to escape the loop, even if you feel stuck
- If gates fail, fix the code and re-run until they pass
- If genuinely stuck after sustained effort, append your blockers to `progress.txt` instead of declaring completion. Do NOT output the promise tag.
