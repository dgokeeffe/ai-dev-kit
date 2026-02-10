# Task: Fix 403 invalid scope errors for Foundation Model API in Databricks Apps

## Objective

When the app runs inside Databricks Apps, the platform injects `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` (service principal credentials) into the environment. These credentials are needed for Lakebase token generation but cause "403 Invalid scope" errors when they leak into Foundation Model API (FMAPI) calls. Fix all code paths so Lakebase uses service principal auth while FMAPI calls use only the user's `X-Forwarded-Access-Token`.

## Context

Read these files to understand the current state:
- `server/app.py` (lines 58-65) - Where CLIENT_ID/SECRET are kept in env (recently changed from stripping them)
- `server/db/database.py` (lines 91-137) - `_get_workspace_client()` uses service principal for Lakebase tokens
- `server/services/agent.py` (lines 66-120, 270-342) - Agent subprocess env setup, already strips CLIENT_ID/SECRET
- `server/routers/pty.py` (lines 130-207) - PTY terminal subprocess env setup, DOES NOT strip CLIENT_ID/SECRET
- `server/services/title_generator.py` (all) - In-process Anthropic client, inherits env with CLIENT_ID/SECRET
- `server/services/user.py` (lines 62-91) - How user token is extracted from X-Forwarded-Access-Token

Check recent changes:
```bash
git log --oneline -10 -- server/app.py server/services/agent.py server/db/database.py
git diff HEAD -- server/app.py server/db/database.py
```

## Technical constraints

- MUST keep `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` in the process env - they are required by `WorkspaceClient()` for Lakebase `generate_database_credential()` calls
- MUST NOT pass `DATABRICKS_CLIENT_ID` or `DATABRICKS_CLIENT_SECRET` to any subprocess or Anthropic client that calls FMAPI (serving-endpoints)
- User tokens come from `X-Forwarded-Access-Token` request header in production
- The `title_generator.py` runs in-process (not a subprocess), so stripping env vars would affect the whole process
- Do not change the authentication flow for local development (ENV=development)
- The app uses `anthropic` Python SDK and `claude-agent-sdk` for FMAPI calls

## Requirements

1. **`server/routers/pty.py`** `_build_claude_env()` (line 184): Strip `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` from the subprocess env dict, matching what `agent.py` already does at lines 293-296
2. **`server/services/title_generator.py`** `_get_client()`: The title generator creates an `AsyncAnthropic` client in-process where `DATABRICKS_CLIENT_ID`/`SECRET` exist in the env. The Anthropic SDK may pick these up. Fix this so the client authenticates using `ANTHROPIC_AUTH_TOKEN` or an explicit `auth_token` parameter, not service principal credentials. Since `title_generator.py` is called from `server/routers/agent.py` during request handling (where the user token is available), thread the user's token through to `generate_title_async()`. If no user token is available (dev mode), fall back to existing behavior.
3. **Verify `agent.py`**: Confirm lines 293-296 correctly strip CLIENT_ID/SECRET (already done, just verify no regression)
4. **No other code paths**: Grep for any other places that create `WorkspaceClient()`, `Anthropic()`, `AsyncAnthropic()`, or `OpenAI()` clients and ensure they use the right credentials
5. All changes must work in both production (Databricks Apps) and development (local) modes

## Completion criteria

The task is COMPLETE when ALL of these are true:
- [ ] `pty.py` `_build_claude_env()` strips DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET from subprocess env
- [ ] `title_generator.py` does NOT rely on env vars that could contain service principal credentials for FMAPI auth
- [ ] `agent.py` still strips CLIENT_ID/SECRET from subprocess env (no regression)
- [ ] `database.py` still uses WorkspaceClient (service principal) for Lakebase tokens (no regression)
- [ ] No other code paths leak service principal credentials into FMAPI calls (verified by grep)
- [ ] No linting errors: `uvx ruff check server/`
- [ ] Format check passes: `uvx ruff format --check server/`

## Instructions

1. Read the context files listed above
2. Fix `server/routers/pty.py` `_build_claude_env()` to strip CLIENT_ID/SECRET from the env dict
3. Fix `server/services/title_generator.py` to properly authenticate to FMAPI without service principal creds. Note: title_generator runs in-process in the FastAPI server, not in a subprocess. It needs the user's token for FMAPI auth. Consider accepting token as a parameter to `generate_title()` and passing it through from the caller.
4. Grep for all `WorkspaceClient`, `Anthropic`, `AsyncAnthropic`, `OpenAI` instantiations in `server/` to verify no other leaks
5. Run `uvx ruff check server/` and `uvx ruff format --check server/` to verify code quality
6. Run tests if any exist: `python -m pytest server/tests/ -v 2>/dev/null || echo "No tests found"`

When ALL completion criteria are verified, output:
<promise>TASK COMPLETE</promise>

IMPORTANT:
- Only output the promise when you have VERIFIED all criteria
- Do NOT output the promise prematurely
- If stuck after multiple attempts, document blockers instead
