# Product Requirements Document: Databricks Claude Forge — Complete Overhaul

**Project:** `databricks-solutions/ai-dev-kit/databricks-builder-app`
**Author:** Solutions Architect (Databricks)
**Date:** February 10, 2026
**Target:** Autonomous Claude Code session via Ralph Wiggum loop
**Estimated Duration:** 8–12 hours overnight

***

## 1. Executive Summary

The Databricks Builder App (`databricks-builder-app`) is a FastAPI + React TypeScript web application that provides a Claude Code agent interface with integrated Databricks tools. While the architecture is sound (SSE streaming, claude-agent-sdk integration, MCP tools, Lakebase persistence), the current implementation has significant gaps in UI polish, branding, interactivity, and key functionality (Git, deployment, templates). This PRD defines a complete overhaul structured for autonomous Claude Code execution using the Ralph Wiggum technique.[^1][^2][^3][^4]

### Current Architecture (Preserve This)
```
React Frontend (client/)  ←→  FastAPI Backend (server/)
   ├── Chat UI                    ├── /api/agent/invoke (SSE)
   ├── Project Selector           ├── /api/projects
   └── Conversation List          ├── /api/conversations
                                  └── Claude Code Session
                                       ├── Built-in Tools (Read, Write, Edit, Glob, Grep, Skill)
                                       ├── MCP Tools (databricks-mcp-server)
                                       └── Skills (.claude/skills/)
```

### Target State
A polished, Databricks-branded IDE experience with resizable panels, working Git integration, functional deployment, real templates with code, and optional code-server integration — comparable to what Azure ML offers with VS Code in the browser.[^5]

***

## 2. Scope

### In Scope
1. **Databricks Branding Overhaul** — colors, typography, logo, component theming
2. **Resizable Panel System** — terminal and panels slide up/down with drag handles
3. **Git Integration** — connect to real Git operations (clone, commit, push, pull, status)
4. **Deployment Pipeline** — make "Deploy" actually deploy to Databricks Apps
5. **Template Integration** — pull real code from `databricks/app-templates`
6. **code-server Bootstrap** — optional VS Code-in-browser panel via embedded code-server

### Out of Scope
- Rewriting the backend agent architecture (it works)
- Changing the claude-agent-sdk integration
- Replacing the MCP server
- Mobile responsive design
- Multi-language i18n

***

## 3. Technical Context

### Existing Tech Stack
| Layer | Technology | Location |
|-------|-----------|----------|
| Frontend | React 18, TypeScript, Tailwind CSS, Vite 6, lucide-react | `client/` |
| Backend | FastAPI, Python 3.11+, SQLAlchemy, Alembic | `server/` |
| Agent | claude-agent-sdk, anthropic SDK | `server/services/agent.py` |
| Database | PostgreSQL via Lakebase | `server/db/` |
| Deployment | Databricks Apps (app.yaml) | `app.yaml` |

### Databricks Brand Identity[^6][^7][^8]
| Token | Value | Usage |
|-------|-------|-------|
| Lava (Primary Red-Orange) | `#FF3621` | Primary CTAs, active states, logo |
| Navy 900 (Gable Green) | `#1B3139` | Headers, dark backgrounds, sidebar |
| Oat Light (Spring Wood) | `#F9F7F4` | Page backgrounds, cards |
| White | `#FFFFFF` | Content areas, modals |
| Font Family | Montreal Serial Medium (headings), system sans-serif (body) | All text |

### code-server Integration Architecture[^9][^10][^11]
```
┌──────────────────────────────────────────────────────────────┐
│  Databricks Builder App (host)                                │
│  ┌────────────────────┐  ┌─────────────────────────────────┐ │
│  │ Chat Panel (React) │  │ code-server (iframe)            │ │
│  │                    │  │ ┌─────────────────────────────┐ │ │
│  │  Agent messages    │  │ │ VS Code Editor              │ │ │
│  │  Tool results      │  │ │ ├── File Explorer           │ │ │
│  │  Streaming output  │  │ │ ├── Integrated Terminal     │ │ │
│  │                    │  │ │ └── Extensions               │ │ │
│  └────────────────────┘  │ └─────────────────────────────┘ │ │
│  ┌─────────────────────────┐                                │ │
│  │ Terminal Panel (xterm)  │  ← resizable, slides up/down   │ │
│  └─────────────────────────┘                                │ │
└──────────────────────────────────────────────────────────────┘
         │                            │
         ▼                            ▼
   FastAPI Backend            code-server process
   (agent, MCP tools)        (port 8443, auth: none)
                              launched per-project
```

code-server is MIT-licensed, requires Linux + WebSockets + 1GB RAM + 2 vCPUs, and supports customization via `--app-name`, `--i18n` JSON files, and proxy configuration. It can be embedded via iframe when self-hosted with proper headers. Communication between host and iframe is best achieved via a custom extension exposing a REST interface.[^12][^10][^9]

***

## 4. User Stories & Acceptance Criteria

### Phase 1: Databricks Branding Overhaul

#### Story 1.1: CSS Variable System
```
AS A user
I WANT the app to look distinctly Databricks-branded
SO THAT it feels like a first-party Databricks product
```

**Acceptance Criteria:**
- [ ] Update `client/src/index.css` (or equivalent) CSS variables:
  - `--color-accent-primary`: `#FF3621` (Lava)
  - `--color-background`: `#F9F7F4` (Oat Light)
  - `--color-bg-secondary`: `#1B3139` (Navy 900 for sidebar)
  - `--color-text-heading`: `#1B3139`
  - `--color-border`: `#E5E0DB` (Oat Medium)
  - `--color-text-primary`: `#2D3436`
  - `--color-text-muted`: `#6B7280`
- [ ] Add dark/light theme toggle using Databricks palette
- [ ] All existing `var(--color-*)` references continue to work

#### Story 1.2: Databricks Logo & Header
```
AS A user
I WANT to see the Databricks logo and proper branding in the header
SO THAT I know I'm using a Databricks tool
```

**Acceptance Criteria:**
- [ ] Replace the generic code icon SVG in `TopBar.tsx` with the Databricks stacked parallelepipeds logo
- [ ] Title reads "Databricks Builder" (not "Databricks AI Dev Kit")
- [ ] Logo renders at 32×32 in the header with proper clear space
- [ ] Favicon updated to Databricks icon

#### Story 1.3: Component Theming
```
AS A user
I WANT all UI components to use the Databricks design system
SO THAT the experience is cohesive
```

**Acceptance Criteria:**
- [ ] Buttons use Lava `#FF3621` for primary, Navy for secondary
- [ ] Input fields have Oat Medium borders, Navy focus rings
- [ ] Cards use white background with subtle Oat Medium border and `border-radius: 12px`
- [ ] Sidebar uses Navy 900 background with white/light text
- [ ] Active navigation items have Lava underline indicator (already partially implemented)
- [ ] Loading spinners use Lava color
- [ ] Toast notifications use Databricks color scheme

***

### Phase 2: Resizable Panel System

#### Story 2.1: Drag-Handle Resize for All Panels
```
AS A user
I WANT to resize the terminal, sidebar, and editor panels by dragging
SO THAT I can customize my workspace layout
```

**Acceptance Criteria:**
- [ ] Install or implement a panel resize library (e.g., `react-resizable-panels` or custom drag handler)
- [ ] Sidebar (`Sidebar.tsx`) resizable horizontally via drag handle on right edge
- [ ] Terminal panel resizable vertically via drag handle on top edge
- [ ] Chat/editor area fills remaining space responsively
- [ ] Minimum/maximum panel sizes enforced (sidebar: 200–400px, terminal: 100–500px)
- [ ] Panel sizes persist to localStorage
- [ ] Double-click on drag handle toggles panel collapse/expand

#### Story 2.2: Slide-Up Terminal Panel
```
AS A user
I WANT the terminal to slide up from the bottom with smooth animation
SO THAT I can quickly access terminal output
```

**Acceptance Criteria:**
- [ ] Add a terminal panel component at the bottom of `MainLayout.tsx`
- [ ] Terminal toggles open/closed with `Ctrl+`` ` keyboard shortcut
- [ ] Smooth CSS transition: `transform: translateY()` with `transition: 300ms ease`
- [ ] Terminal shows agent output, tool results, and command execution in real-time
- [ ] Terminal content is scrollable with auto-scroll-to-bottom
- [ ] Implement using xterm.js for proper terminal emulation

#### Story 2.3: Collapsible Activity/Thinking Panel
```
AS A user
I WANT to expand/collapse the agent's thinking and tool activity
SO THAT I can focus on results or debug issues
```

**Acceptance Criteria:**
- [ ] Wrap the `ActivitySection` in `ProjectPage.tsx` in a collapsible container
- [ ] Smooth height animation on expand/collapse
- [ ] Show tool name as summary when collapsed
- [ ] Show full tool input/output when expanded
- [ ] Persist collapse state per conversation

***

### Phase 3: Git Integration

#### Story 3.1: Git Repository Operations
```
AS A developer
I WANT to connect my project to a Git repository
SO THAT I can version control my work
```

**Acceptance Criteria:**
- [ ] Add new backend router: `server/routers/git.py`
- [ ] Implement endpoints:
  - `POST /api/git/clone` — Clone a repo into project directory
  - `GET /api/git/status` — Return current branch, changed files, ahead/behind
  - `POST /api/git/commit` — Stage all + commit with message
  - `POST /api/git/push` — Push to remote
  - `POST /api/git/pull` — Pull from remote
  - `GET /api/git/branches` — List branches
  - `POST /api/git/checkout` — Switch branch
- [ ] Git operations execute via `subprocess` calling `git` CLI in project directory
- [ ] Authentication via user's Databricks token for Databricks Repos, or SSH key / HTTPS credentials for GitHub

#### Story 3.2: Git Status UI
```
AS A developer
I WANT to see Git status in the UI
SO THAT I know what branch I'm on and what's changed
```

**Acceptance Criteria:**
- [ ] Add Git status indicator to `TopBar.tsx` showing: branch name, dirty indicator (●), ahead/behind count
- [ ] Add Git panel in sidebar showing changed files with diff indicators (+/-/M)
- [ ] "Commit & Push" button in toolbar that opens commit message dialog
- [ ] Auto-refresh Git status after agent file operations
- [ ] Error handling for non-Git directories (show "Initialize Git" button instead)

***

### Phase 4: Deployment Pipeline

#### Story 4.1: Databricks Apps Deployment
```
AS A developer
I WANT to click "Deploy" and have my app actually deploy to Databricks Apps
SO THAT I can see my work running in production
```

**Acceptance Criteria:**
- [ ] Add new backend router: `server/routers/deploy.py`
- [ ] Implement deployment pipeline:
  1. Validate project structure (check for `app.yaml`, `app.py` or `requirements.txt`)
  2. Build frontend if applicable (`npm run build` for Node.js apps)
  3. Call Databricks CLI: `databricks apps deploy <app-name> --source-code-path <project-dir>`
  4. Stream deployment status back to frontend via SSE
  5. Return deployed app URL on success
- [ ] Use `databricks-sdk` Python package for API calls (already in requirements)
- [ ] Implement deployment status polling: `databricks apps get <app-name>` until status is RUNNING or FAILED
- [ ] Store deployment history in Lakebase (app_name, version, status, url, timestamp)

#### Story 4.2: Deploy UI
```
AS A developer
I WANT a deploy button with real-time feedback
SO THAT I know what's happening during deployment
```

**Acceptance Criteria:**
- [ ] Add "Deploy" button to `TopBar.tsx` (rocket icon, Lava colored)
- [ ] Clicking opens a deploy dialog with: app name input, source code path, environment selector
- [ ] Real-time deployment log streamed in the terminal panel
- [ ] Status badges: Building → Deploying → Running (with animated transitions)
- [ ] "Open App" button appears on successful deployment with the app URL
- [ ] Error state shows error message with retry button

***

### Phase 5: Template Integration

#### Story 5.1: Pull Real Templates from databricks/app-templates
```
AS A developer
I WANT to start from real, working templates with actual code
SO THAT I can build on proven patterns instead of empty scaffolds
```

**Acceptance Criteria:**
- [ ] Add backend service: `server/services/templates.py`
- [ ] Fetch template catalog from `https://github.com/databricks/app-templates` (clone to cache dir on startup, refresh periodically)
- [ ] Template catalog includes all templates:[^13]
  - **Hello World**: streamlit, dash, gradio, shiny, flask, nodejs-fastapi
  - **Agents**: openai-agents-sdk, langgraph, langgraph-short-term-memory, langgraph-long-term-memory, non-conversational, e2e-chatbot-app-next, mcp-server-hello-world, mcp-server-open-api-spec
  - **Dashboard**: streamlit-data-app, dash-data-app, gradio-data-app, shiny-data-app
  - **Database**: streamlit-database-app, flask-database-app
- [ ] Each template entry includes: name, description, framework, dependencies, file list
- [ ] `POST /api/templates/apply` copies template files into project directory
- [ ] Template files include **actual working code** (e.g., the Streamlit hello-world `app.py`, `requirements.txt`, `app.yaml`)[^13]

#### Story 5.2: Template Selection UI
```
AS A developer
I WANT to browse and preview templates visually
SO THAT I can choose the right starting point
```

**Acceptance Criteria:**
- [ ] Add template browser to project creation flow on `HomePage.tsx`
- [ ] Templates displayed in card grid grouped by category (Hello World, Agents, Dashboard, Database)
- [ ] Each card shows: template name, framework icon, description, dependency badges
- [ ] Click card to preview: file tree, code preview (syntax-highlighted), app.yaml contents
- [ ] "Use Template" button creates project with template files copied in
- [ ] Search/filter by framework (Streamlit, Gradio, Flask, etc.)

***

### Phase 6: code-server Integration (VS Code in Browser)

#### Story 6.1: code-server Lifecycle Management
```
AS A developer
I WANT VS Code available in my browser alongside the chat
SO THAT I can edit files with full IDE capabilities
```

**Acceptance Criteria:**
- [ ] Add backend service: `server/services/code_server.py`
- [ ] On project open, check if code-server is installed (`which code-server`)
- [ ] If installed, spawn code-server process bound to a random available port:
  ```bash
  code-server --bind-addr 127.0.0.1:{port} --auth none --disable-telemetry \
    --app-name "Databricks Builder" \
    --user-data-dir /tmp/code-server-{project_id} \
    {project_directory}
  ```
- [ ] Track process lifecycle: start, health-check, stop on project close
- [ ] Proxy code-server through FastAPI at `/code-server/{project_id}/` using `httpx` reverse proxy
- [ ] WebSocket proxying for code-server's real-time features
- [ ] Clean shutdown on app exit (kill child processes)

#### Story 6.2: Embedded VS Code Panel
```
AS A developer
I WANT the VS Code editor embedded in the app layout
SO THAT I don't need to switch between browser tabs
```

**Acceptance Criteria:**
- [ ] Add `CodeServerPanel.tsx` component that renders an iframe to `/code-server/{project_id}/`
- [ ] Panel occupies the right 60% of the screen (resizable with Phase 2 drag handles)
- [ ] Chat panel on the left 40%
- [ ] Toggle button to switch between "Chat + Code" layout and "Full Chat" layout
- [ ] iframe loads with Databricks-themed VS Code (use code-server's `--i18n` for custom welcome text)[^10]
- [ ] Fallback: if code-server unavailable, show the existing chat-only view with a "VS Code not available" banner

#### Story 6.3: Bidirectional Communication
```
AS A developer
I WANT the chat agent's file edits to appear in VS Code immediately
SO THAT I can see changes in real-time
```

**Acceptance Criteria:**
- [ ] When Claude agent writes/edits files via built-in tools, the changes appear in VS Code file explorer automatically (code-server watches the filesystem)
- [ ] Add a VS Code extension stub (bundled with code-server) that exposes a local REST API for:
  - Opening specific files: `POST /api/open-file {path: string}`
  - Navigating to line: `POST /api/goto {path: string, line: number}`
- [ ] After agent file operations, send `open-file` command to code-server extension
- [ ] Agent tool results that reference file paths become clickable links that open in VS Code panel

***

## 5. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| First Paint | < 2 seconds |
| Panel Resize | 60fps, no jank |
| Template Load | < 3 seconds for catalog |
| Deploy Feedback | < 500ms latency for status updates |
| code-server Launch | < 10 seconds from project open |
| Browser Support | Chrome 120+, Firefox 120+, Safari 17+ |
| Accessibility | WCAG 2.1 AA for all interactive elements |

***

## 6. Ralph Loop Configuration

### Prerequisites
```bash
# Install Ralph globally
git clone https://github.com/frankbria/ralph-claude-code.git
cd ralph-claude-code
./install.sh

# OR use the simple bash loop approach:
```

### Option A: Using ralph-claude-code[^3]

```bash
# Import this PRD into Ralph
cd /path/to/ai-dev-kit/databricks-builder-app
ralph-import /path/to/this-prd.md databricks-builder-overhaul

# Review generated files, then:
ralph --monitor --timeout 60 --calls 80
```

### Option B: Simple Bash Ralph Loop[^2]

Create `run_overnight.sh` in the repo root:

```bash
#!/bin/bash
# Ralph Wiggum Loop for Databricks Builder App Overhaul
# Run: chmod +x run_overnight.sh && ./run_overnight.sh

set -e

MAX_ITERATIONS=50
COMPLETION_PROMISE="FORGE_COMPLETE"
ITERATION=0
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

PROMPT_FILE="$PROJECT_DIR/OVERNIGHT_PROMPT.md"

while [ $ITERATION -lt $MAX_ITERATIONS ]; do
  ITERATION=$((ITERATION + 1))
  echo "========================================="
  echo "Ralph Loop Iteration: $ITERATION / $MAX_ITERATIONS"
  echo "Time: $(date)"
  echo "========================================="

  # Run Claude Code with the prompt
  OUTPUT=$(claude -p "$(cat $PROMPT_FILE)" \
    --output-format json \
    --allowedTools 'Write,Read,Edit,Bash(npm *),Bash(npx *),Bash(git *),Bash(python *),Bash(pip *),Bash(cat *),Bash(ls *),Bash(find *),Bash(grep *),Bash(cd *),Bash(mkdir *),Bash(cp *),Bash(curl *),Glob,Grep' \
    2>&1) || true

  # Check for completion promise
  if echo "$OUTPUT" | grep -q "$COMPLETION_PROMISE"; then
    echo "✅ Completion promise detected! All tasks done."
    echo "Finished at iteration $ITERATION"
    break
  fi

  echo "⏳ No completion promise yet, continuing..."
  sleep 10
done

echo "Ralph loop ended after $ITERATION iterations."
```

### CLAUDE.md Configuration

Add this to the project's `CLAUDE.md`:

```markdown
# Databricks Builder App - Development Guide

## Project Structure
- `client/` - React 18 + TypeScript + Tailwind CSS + Vite 6
- `server/` - FastAPI + Python 3.11+
- `server/routers/` - API route handlers
- `server/services/` - Business logic
- `server/db/` - SQLAlchemy models + Alembic migrations
- `client/src/components/` - React components
- `client/src/pages/` - Page-level components
- `client/src/lib/` - Utilities, types, API client

## Build Commands
- Frontend dev: `cd client && npm install && npm run dev`
- Frontend build: `cd client && npm run build`
- Backend dev: `cd .. && uvicorn server.app:app --reload --port 8000`
- Type check: `cd client && npx tsc --noEmit`
- Lint: `cd client && npm run lint`

## Key Conventions
- Use CSS variables for ALL colors (never hardcode hex in components)
- Use Tailwind utility classes with CSS variable references: `bg-[var(--color-*)]`
- All API endpoints prefixed with `/api/`
- Backend routers go in `server/routers/`, services in `server/services/`
- React components use TypeScript strict mode
- Use lucide-react for all icons

## Databricks Brand Colors
- Lava (Primary): #FF3621
- Navy 900: #1B3139
- Oat Light: #F9F7F4
- Oat Medium: #E5E0DB
- White: #FFFFFF

## Testing Verification
After each change:
1. Run `cd client && npx tsc --noEmit` — must pass
2. Run `cd client && npm run build` — must succeed
3. Visually verify by checking component renders
```

### OVERNIGHT_PROMPT.md

```markdown
You are working on the Databricks Builder App. Read the PRD at ./PRD.md for full details.

## Your Mission
Work through the user stories in order (Phase 1 → Phase 6). For each story:

1. Read the acceptance criteria
2. Implement the changes
3. Run verification:
   - `cd client && npx tsc --noEmit` (must pass)
   - `cd client && npm run build` (must succeed)
   - Check that no existing functionality is broken
4. Mark the story complete in @fix_plan.md
5. Move to the next story

## Progress Tracking
Update @fix_plan.md after completing each story. Format:
- [x] Story 1.1: CSS Variable System
- [ ] Story 1.2: Databricks Logo & Header
...

## Critical Rules
- NEVER delete existing working functionality
- ALWAYS use CSS variables for colors, never hardcode
- ALWAYS run TypeScript check after frontend changes
- ALWAYS run build after completing a story
- If a build fails, fix it before moving on
- If you complete ALL stories, output: FORGE_COMPLETE
- If blocked on a story, skip it, document why in @fix_plan.md, move to next

## Verification Gates (Phase-Level)
After completing each phase, verify:
- Phase 1: Take screenshot, verify Databricks colors visible
- Phase 2: Verify panel resize works by checking DOM structure
- Phase 3: Verify git endpoints return 200 on `/api/git/status`
- Phase 4: Verify deploy endpoint exists and returns schema
- Phase 5: Verify template catalog loads from disk
- Phase 6: Verify code-server service module exists and has lifecycle methods
```

***

## 7. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Context window exhaustion | High | Medium | Two-phase approach: planning (this PRD) → implementation (Ralph loop). PRD is the anchor. |
| Agent invents features | Medium | High | Explicit scope boundaries and "out of scope" list. CLAUDE.md as pin. |
| Build breaks mid-loop | Medium | High | Verification gate after every story. Circuit breaker in Ralph. |
| code-server process management | Medium | Medium | Phase 6 is last; if it fails, phases 1–5 still deliver major value. |
| npm/pip dependency conflicts | Low | High | Pin versions in package.json and requirements.txt. |
| Git operations security | Medium | Medium | Scope Git operations to project directory only. No credential storage. |

***

## 8. Success Metrics

After the overnight session, evaluate:

1. **Branding Score**: Does the app visually match Databricks brand guidelines? (Lava accent, Navy sidebar, Oat backgrounds)
2. **Panel Interactivity**: Can panels be resized via drag? Does terminal slide up/down?
3. **Git Functional**: Does `GET /api/git/status` return valid JSON for a git-initialized project?
4. **Deploy Functional**: Does `POST /api/deploy` trigger a Databricks Apps deployment (even if it fails auth in dev)?
5. **Templates Populated**: Does the template catalog contain real code from `databricks/app-templates`?
6. **code-server Bootstrap**: Does `server/services/code_server.py` exist with start/stop/health methods?
7. **Build Green**: Does `npm run build` pass with zero errors?
8. **TypeScript Clean**: Does `npx tsc --noEmit` pass with zero errors?

***

## 9. Post-Session Review Checklist

After waking up, review in this order:

1. Check `@fix_plan.md` for completion status
2. Run `cd client && npm run build` — verify green
3. Run `cd client && npx tsc --noEmit` — verify clean
4. Start the app locally: `uvicorn server.app:app --reload`
5. Open `http://localhost:8000` — visual inspection
6. Test each phase manually:
   - Phase 1: Colors and branding visible?
   - Phase 2: Drag resize works?
   - Phase 3: Git panel shows status?
   - Phase 4: Deploy button opens dialog?
   - Phase 5: Template browser shows real templates?
   - Phase 6: code-server panel loads?
7. Run `git diff --stat` to review all changes
8. Create feature branch and PR

***

*This PRD is structured for autonomous agent consumption. Each story is self-contained with measurable acceptance criteria. The Ralph loop will process stories sequentially, verify after each, and continue until all are complete or the completion promise is emitted.*

---

## References

1. [databricks-solutions/ai-dev-kit - GitHub](https://github.com/databricks-solutions/ai-dev-kit) - The AI Dev Kit gives your AI coding assistant (Claude Code, Cursor, Windsurf, etc.) the trusted sour...

2. [Claude Code Ralph Wiggum: Run Autonomously Overnight](https://claudefa.st/blog/guide/mechanics/ralph-wiggum-technique) - The complete guide to Ralph Wiggum loops. Learn stop hooks, completion promises, and verification-fi...

3. [frankbria/ralph-claude-code: Autonomous AI development loop for ...](https://github.com/frankbria/ralph-claude-code) - Ralph is an implementation of the Geoffrey Huntley's technique for Claude Code that enables continuo...

4. [GitHub - databricks-solutions/ai-dev-kit - LinkedIn](https://www.linkedin.com/posts/cankoklu_github-databricks-solutionsai-dev-kit-activity-7425094694973485056-WUaq) - Accelerate your Databricks Development with the AI Dev Kit https://lnkd.in/e8v4zx6D Claude and Curso...

5. [Start Visual Studio Code Integrated with Azure Machine Learning](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-launch-vs-code-remote?view=azureml-api-2) - We recommend VS Code for the Web because you can do all your machine learning work directly from a b...

6. [Databricks Brand Color Codes » BrandColorCode.com](https://www.brandcolorcode.com/databricks) - Databricks brand hex, RGB, CMYK and Pantone® (PMS) color codes ; RGB values, (27, 49, 57) ; CMYK val...

7. [The Databricks Logo History, Colors, Font, And Meaning](https://www.designyourway.net/blog/databricks-logo/) - The Databricks logo is a combination mark featuring stacked rectangular parallelepipeds in red-orang...

8. [Databricks Brand Guidelines | Brand overview](https://brand.databricks.com) - The Databricks primary brand colors are Lava 600, Navy 900, Oat Medium, Oat Light and White. Navy, O...

9. [embed in an iframe · Issue #621 · coder/code-server - GitHub](https://github.com/cdr/code-server/issues/621) - If you're self-hosting you should be able to set any headers you want, including those necessary for...

10. [Securely Access & Expose code-server - Coder](https://coder.com/docs/code-server/guide) - This article will walk you through exposing code-server securely once you've completed the installat...

11. [coder/code-server: VS Code in the browser - GitHub](https://github.com/coder/code-server) - See requirements for minimum specs, as well as instructions on how to set up a Google VM on which yo...

12. [Pass messages from host to iframe embedded code-server #5186](https://github.com/coder/code-server/discussions/5186) - I am trying to figure out a way to send a message/event to my custom extension in code-server from t...

13. [databricks/app-templates - GitHub](https://github.com/databricks/app-templates) - A todo app that stores tasks in a Postgres database hosted on Databricks, Database. flask-database-a...

