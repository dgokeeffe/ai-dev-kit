# Databricks Claude Forge - Deep Audit

You are auditing the Databricks Builder App for correctness. This is a **fresh-context loop** - you have NO memory of previous iterations.

## Your mission

Systematically verify that every route, button, and component is properly wired up. Create a verification report and fix any issues found.

## Audit process

### Step 1: Run gates first
```bash
bash gates.sh
```
All gates must pass before proceeding.

### Step 2: Backend route audit

Read `server/routers/__init__.py` and `server/app.py` to list all registered routers.

For EACH router file in `server/routers/`:
1. List all endpoints (GET, POST, PUT, DELETE)
2. Verify the endpoint path makes sense
3. Check for any unhandled exceptions or missing error handling
4. Note any endpoints that seem incomplete

Write findings to `AUDIT_BACKEND.md`.

### Step 3: Frontend-Backend contract audit

Read `client/src/lib/api.ts` to understand all API calls.

For EACH API function:
1. Verify the backend endpoint exists
2. Check request/response types match
3. Look for hardcoded URLs that should use API_BASE

Also check components that make direct fetch calls:
- `client/src/components/git/SourceControl.tsx`
- Any other components with `fetch(` calls

Write findings to `AUDIT_API_CONTRACT.md`.

### Step 4: Button and handler audit

For EACH component in `client/src/components/`:
1. Find all `<button` and `onClick` handlers
2. Verify each onClick calls a real function
3. Check for buttons with `onClick={() => {}}` (empty handlers)
4. Check for buttons missing onClick entirely
5. Verify async handlers have proper error handling

Write findings to `AUDIT_BUTTONS.md`.

### Step 5: Fix any issues

If you find:
- Buttons with empty handlers → implement them or remove the button
- API calls to non-existent endpoints → fix the URL or create the endpoint
- Missing error handling → add try/catch
- Type mismatches → fix the types

### Step 6: Final verification

1. Run `bash gates.sh` - must pass
2. Run `cd client && npm run build` - must succeed
3. Review your audit files for any CRITICAL issues

## Output format

Create these files:
- `AUDIT_BACKEND.md` - Backend route analysis
- `AUDIT_API_CONTRACT.md` - Frontend-backend contract check
- `AUDIT_BUTTONS.md` - UI handler analysis
- Update `progress.txt` with summary

## Completion

When:
1. All audit files are created
2. All CRITICAL issues are fixed
3. `bash gates.sh` passes
4. `npm run build` succeeds

Output:

<promise>AUDIT_COMPLETE</promise>

## Critical rules

- Read files before making changes
- Run gates after any code changes
- Be thorough - check EVERY component
- Document issues even if you can't fix them
- Do NOT output the promise until audit is complete
