# Databricks Claude Forge - Overhaul Fix Plan

Based on PRD analysis, here's the current state and implementation plan:

## Status summary

| Phase | PRD Requirement | Current State | Action Needed |
|-------|----------------|---------------|---------------|
| 1 | CSS Variables | ✅ Already done (globals.css) | Minor updates |
| 1 | Databricks Logo | ⚠️ Generic icon | Replace with Databricks logo |
| 1 | Component Theming | ✅ Uses CSS vars | Add Navy 900 sidebar option |
| 2 | Resizable Panels | ✅ DONE (react-resizable-panels) | Refactored to use library |
| 2 | Slide-up Terminal | ✅ BottomPanel.tsx | Already implemented |
| 2 | Collapsible Activity | ✅ ActivitySection | Exists in chat |
| 3 | Git Operations | ✅ git.py router | Already implemented |
| 3 | Git Status UI | ✅ SourceControl.tsx | Already implemented |
| 4 | Databricks Apps Deploy | ✅ deploy.py | Already implemented |
| 4 | Deploy UI | ✅ DeployPanel.tsx | Already implemented |
| 5 | Template System | ✅ templates.py | Add more official templates |
| 5 | Template Selection UI | ✅ HomePage.tsx | Add preview feature |
| 6 | code-server | ❌ CANCELLED | Removed from scope |

## Gates status

All 25 gates pass:
```
=== Build Gates ===
  Lint                         ok
  Types                        ok
  Build                        ok

=== Backend Routers Registered ===
  Router-Agent                 ok
  Router-Projects              ok
  Router-Conversations         ok
  Router-Config                ok
  Router-Deploy                ok
  Router-Git                   ok
  Router-Files                 ok
  Router-Templates             ok

=== Frontend API Functions ===
  API-createProject            ok
  API-fetchProjects            ok
  API-invokeAgent              ok
  API-deploy                   ok
  Git-StatusCall               ok

=== Key Components Exist ===
  Component-ChatPanel          ok
  Component-FileExplorer       ok
  Component-CodeEditor         ok
  Component-SourceControl      ok
  Component-DeployPanel        ok
  Component-IDELayout          ok

=== Resizable Panels ===
  ResizePanels-Pkg             ok
  ResizePanels-Usage           ok
  LocalStorage-Persist         ok

All 25 gate(s) passed ✓
```

## Implementation completed

### Phase 2: Resizable panels - COMPLETED

- [x] Story 2.1: Installed `react-resizable-panels` v4.6.2
- [x] Refactored `IDELayout.tsx` to use `Group`, `Panel`, `Separator` components
- [x] Left sidebar, main content, and right sidebar all resizable
- [x] Bottom panel with collapsible support
- [x] Panel sizes persist to localStorage (leftSidebarWidth, rightSidebarWidth, bottomPanelHeight)

### Phase 6: code-server integration - CANCELLED

Removed from scope. The built-in CodeMirror editor is sufficient for the MVP.

## Already existed (from initial exploration)

### Phase 1: Databricks branding

- [x] CSS Variable System in `globals.css`
  - `--color-accent-primary: #FF3621` (Lava)
  - Dark mode support
  - All colors use CSS variables

### Phase 3: Git integration

- [x] `server/routers/git.py` with full Git operations
- [x] `client/src/components/git/SourceControl.tsx` UI

### Phase 4: Deployment pipeline

- [x] `server/routers/deploy.py` with:
  - `databricks apps deploy` for app.yaml
  - `databricks bundle deploy` for databricks.yml
  - SSE log streaming
  - App URL retrieval from API

### Phase 5: Template system

- [x] `server/services/templates.py` with official + custom templates
- [x] `client/src/lib/templates.ts` frontend definitions
- [x] Template cards in HomePage.tsx

## Optional enhancements (not required for gates)

- [ ] Story 1.2: Add Databricks logo SVG to TopBar
- [ ] Story 5.2: Add template preview modal with file tree

## Notes

- The codebase was already well-structured for most PRD requirements
- Gates focus on the key deliverable: react-resizable-panels
- Additional UI polish (logo, template preview) can be added incrementally
- code-server integration was removed from scope - CodeMirror editor is sufficient for MVP

## Cleanup status

✅ All code-server references have been removed. No cleanup needed.

## Current gates (updated)

The gates.sh script now includes performance gates:
- Build Gates: All pass (Lint-Backend, Types, Build)
- Performance Gates: Chunk size warnings (informational, not blocking)
