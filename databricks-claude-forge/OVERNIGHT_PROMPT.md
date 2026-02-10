# Databricks Claude Forge - Iteration 2

You are implementing features for the Databricks Builder App. This is a **fresh-context loop** - you have NO memory of previous iterations. Your only state is in files.

## First: Check state

1. Run `bash gates.sh` to see which gates are failing
2. Read `progress.txt` to see what's been done
3. Focus ONLY on failing gates

## Remaining work (from quality review)

### Phase 2: localStorage persistence (2 gates failing)

The resizable panels work but don't persist sizes across page reloads.

**Required changes in `client/src/pages/ProjectPage.tsx`:**

1. On mount, load saved sizes from localStorage:
```typescript
const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => {
  const saved = localStorage.getItem('panel-left-sidebar-width');
  return saved ? parseInt(saved, 10) : 200;
});
```

2. When sizes change, save to localStorage:
```typescript
const handleLeftSidebarWidthChange = (width: number) => {
  setLeftSidebarWidth(width);
  localStorage.setItem('panel-left-sidebar-width', String(width));
};
```

Do this for: `leftSidebarWidth`, `rightSidebarWidth`, `bottomPanelHeight`

### Phase 6: code-server API + Frontend (4 gates failing)

The backend service exists at `server/services/code_server.py` but needs:

**1. Create `server/routers/code_server.py`:**
- `POST /api/code-server/{project_id}/start` - Start code-server for project
- `POST /api/code-server/{project_id}/stop` - Stop code-server
- `GET /api/code-server/{project_id}/health` - Check status
- `GET /api/code-server/instances` - List all running instances
- Import and use functions from `server/services/code_server`
- Register router in `server/routers/__init__.py` and `server/app.py`

**2. Create `client/src/components/editor/CodeServerPanel.tsx`:**
- Simple iframe component that embeds code-server
- Props: `projectId: string`, `isVisible: boolean`
- Fetch health endpoint to get the URL
- Render `<iframe src={url} />` when running
- Show "Start VS Code" button when not running
- Show "code-server not available" message if not installed

## Work process

1. Run `bash gates.sh` - note which gates fail
2. Fix ONE gate at a time
3. Run `bash gates.sh` again - verify gate passes
4. Append what you did to `progress.txt`
5. Repeat until all gates pass

## Critical rules

- NEVER break existing functionality
- ALWAYS run `bash gates.sh` after changes
- ALWAYS append to `progress.txt` (never overwrite)
- If build/lint/types fail, fix IMMEDIATELY before continuing
- The localStorage gates check for specific patterns - use the exact approach shown above

## Completion

When `bash gates.sh` shows ALL gates passing (exit code 0), output:

<promise>FORGE_COMPLETE</promise>

Do NOT output the promise until gates pass. Verify by running `bash gates.sh` one final time.
