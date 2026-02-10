# Test results - IDE layout features

Date: 2026-02-06 (revalidation pass)

## Summary

Thoroughly retested all three IDE features: Claude terminal maximize/restore, bottom panel height improvements, and git source control panel. All features verified working. No new bugs found. Previously fixed bugs (hooks ordering, optional chaining) remain resolved.

## Static analysis

| Check | Result |
|-------|--------|
| TypeScript (`npx tsc --noEmit`) | PASS - no errors |
| Python lint (`uvx ruff check server/routers/git.py`) | PASS - all checks passed |
| Python format (`uvx ruff format --check server/routers/git.py`) | PASS - already formatted |

## Backend git API endpoints (all 10 tested via curl)

| # | Endpoint | Method | Result | Notes |
|---|----------|--------|--------|-------|
| 1 | `/git/status` | GET | PASS | Returns branch, files array, ahead/behind counts |
| 2 | `/git/branches` | GET | PASS | Returns branches array (empty for new repo) |
| 3 | `/git/log` | GET | PASS | Returns commits array (empty for new repo) |
| 4 | `/git/diff` | GET | PASS | Returns diff content, handles untracked files as new-file diff |
| 5 | `/git/stage` | POST | PASS | Successfully stages files |
| 6 | `/git/unstage` | POST | PASS | Successfully unstages files |
| 7 | `/git/commit` | POST | PASS | Validates empty message (returns 400) |
| 8 | `/git/push` | POST | PASS | Returns error correctly when no remote configured |
| 9 | `/git/pull` | POST | PASS | Returns error correctly when no tracking info |
| 10 | `/git/checkout` | POST | PASS | Validates empty branch name (returns 400) |

## UI feature tests (Chrome DevTools)

### Homepage

| Test | Result | Screenshot |
|------|--------|------------|
| Homepage loads with projects listed | PASS | 01_homepage.png |

### IDE layout (ProjectPage)

| Test | Result | Screenshot |
|------|--------|------------|
| IDE layout renders (ActivityBar, Explorer, Editor, Claude terminal, Bottom panel) | PASS | 02_project_page.png |
| No console errors on page load | PASS | (checked via list_console_messages - only expected WS warnings) |

### Bottom panel

| Test | Result | Screenshot |
|------|--------|------------|
| Bottom panel visible with Terminal/Output/Deploy tabs | PASS | 03_bottom_panel_open.png |
| Bottom panel has resize grip handle | PASS | 03_bottom_panel_open.png |
| Terminal content renders inside bottom panel (shows working directory + shell prompt) | PASS | 03_bottom_panel_open.png |
| Toggle open/close works (button changes between Expand/Collapse) | PASS | verified via snapshot |
| Keyboard toggle Cmd+` works | PASS | 14_bottom_panel_toggled.png |

### Claude terminal maximize/restore

| Test | Result | Screenshot |
|------|--------|------------|
| Maximize button (Maximize2 icon) visible in Claude terminal header | PASS | 02_project_page.png |
| Clicking maximize expands Claude terminal to fill main content area | PASS | 04_claude_maximized.png |
| Editor panes hidden when maximized | PASS | 04_claude_maximized.png |
| Right sidebar hidden when maximized | PASS | 04_claude_maximized.png |
| Bottom panel hidden when maximized | PASS | 04_claude_maximized.png |
| Restore button (Minimize2) visible when maximized | PASS | 04_claude_maximized.png |
| Clicking restore returns Claude terminal to right sidebar | PASS | 05_claude_restored.png |
| Editor panes reappear after restore | PASS | 05_claude_restored.png |
| Maximize button visible again after restore | PASS | 05_claude_restored.png |

### Git source control panel

| Test | Result | Screenshot |
|------|--------|------------|
| Git icon appears in ActivityBar (3rd icon) | PASS | 06_git_panel.png |
| Clicking git icon opens Source Control panel | PASS | 06_git_panel.png |
| SOURCE CONTROL header with refresh button | PASS | 06_git_panel.png |
| Current branch name displayed ("HEAD") | PASS | 06_git_panel.png |
| Pull/Push buttons visible | PASS | 06_git_panel.png |
| Changes/Log view mode tabs | PASS | 06_git_panel.png |
| Commit message textarea | PASS | 06_git_panel.png |
| Commit button with staged count ("Commit (0 staged)") | PASS | 06_git_panel.png |
| Files grouped by status (Untracked section with count badge) | PASS | 06_git_panel.png |
| File status badges (U for untracked) | PASS | 06_git_panel.png |
| Staging a file (+ button) moves it to Staged Changes with A badge | PASS | 07_file_staged.png |
| Commit button updates count ("Commit (1 staged)") | PASS | 07_file_staged.png |
| Unstaging a file (- button) moves it back to Untracked | PASS | 08_file_unstaged.png |
| Clicking a file opens diff in editor tab | PASS | 09_diff_view.png |
| Diff shows unified diff format (--- /dev/null, +++ b/file, @@ lines) | PASS | 09_diff_view.png |
| Log view shows "No commits yet" for new repo | PASS | 10_log_view.png |

### ActivityBar toggle behavior

| Test | Result | Screenshot |
|------|--------|------------|
| Click explorer: shows file explorer sidebar | PASS | 11_explorer_toggle.png |
| Click git: switches to source control sidebar | PASS | 06_git_panel.png |
| Click same icon again: closes sidebar entirely | PASS | 12_sidebar_closed.png |

### Keyboard shortcuts

| Shortcut | Action | Result | Screenshot |
|----------|--------|--------|------------|
| Cmd+Shift+P | Opens command palette | PASS | 13_command_palette.png |
| Cmd+Shift+E | Toggles explorer sidebar | PASS | verified via snapshot |
| Cmd+` | Toggles bottom panel | PASS | 14_bottom_panel_toggled.png |
| Cmd+Shift+C | Toggles Claude terminal (right sidebar) | PASS | 15_claude_hidden.png |

## Console errors

Only warnings observed (no errors):
- WebSocket connection warnings for terminal PTY - expected in dev mode when WS proxy has brief race conditions during reconnection. Not related to the features being tested.

## Bugs found during this session

**None.** All previously fixed bugs remain resolved. All features working correctly.

## Previously fixed bugs (from prior session)

1. **React hooks ordering violation in ProjectPage.tsx** - `handleOpenDiff` useCallback was after an early return, violating React's hooks rules. Fixed by moving it before the loading check.
2. **Crash in SourceControl when API returns error** - Missing optional chaining on `status?.files?.filter(...)`. Fixed on all three filter operations.

## Screenshots location

All screenshots saved to scratchpad directory during testing session.
