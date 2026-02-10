# Task: Add project templates, guided prompts, and app preview panel

## Objective

Enhance the project creation and development experience to compete with Power BI, Azure AI Foundry, and Snowflake for building apps, dashboards, chatbots, and internal tools on Databricks. Add template-based project creation, context-aware starter prompts, and an embedded app preview panel so users go from zero to deployed app faster.

## Context

Read these files:
- `client/src/pages/HomePage.tsx` - Current project creation (plain text input, no templates)
- `client/src/pages/ProjectPage.tsx` - IDE layout, bottom panel tabs, ClaudeTerminal integration
- `client/src/components/layout/BottomPanel.tsx` - Tab types: 'terminal' | 'output' | 'deploy'
- `client/src/components/editor/DeployPanel.tsx` - Deploy panel with "Open App" external link
- `client/src/components/terminal/ClaudeTerminal.tsx` - Claude terminal component (right sidebar)
- `server/routers/projects.py` - CreateProjectRequest only has `name: str`
- `server/services/storage.py` - ProjectStorage.create() method
- `server/services/backup_manager.py` - `_create_default_claude_md()` and `ensure_project_directory()`
- `client/src/lib/api.ts` - `createProject()` API call
- `client/src/lib/types.ts` - Project type definition
- `client/src/contexts/ProjectsContext.tsx` - Project context with createProject
- `app.yaml` - ENABLED_SKILLS lists all available skills

## Requirements

### 1. Template-based project creation

#### a) Define templates as static data (frontend)

Create `client/src/lib/templates.ts` with 4 project templates:

```typescript
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  color: string; // tailwind color class
  starterFiles: Record<string, string>; // path -> content
  claudeMd: string; // template-specific CLAUDE.md content
  suggestedPrompts: string[]; // 3-4 starter prompts shown in terminal
  skills: string[]; // relevant skills to highlight
}
```

Templates to define:

1. **Chatbot / AI agent** (`chatbot`)
   - Description: "Build a conversational AI agent with Databricks Foundation Models"
   - Starter files: `app.py` (FastAPI + OpenAI client pattern), `requirements.txt`, `app.yaml`
   - CLAUDE.md: Foundation Model API context, chat patterns, function calling
   - Suggested prompts: "Add a knowledge base from Unity Catalog tables", "Add function calling to query sales data", "Deploy this chatbot as a Databricks App"
   - Skills: agent-bricks, databricks-app-python, databricks-unity-catalog

2. **Dashboard app** (`dashboard`)
   - Description: "Create an interactive data dashboard with charts and filters"
   - Starter files: `app.py` (Dash/Plotly skeleton), `requirements.txt`, `app.yaml`
   - CLAUDE.md: SQL warehouse context, Plotly charting, data loading patterns
   - Suggested prompts: "Connect to my sales table and show revenue trends", "Add date range filters and product category breakdown", "Add a SQL-powered search across inventory"
   - Skills: aibi-dashboards, databricks-unity-catalog, databricks-app-python

3. **Internal tool** (`internal-tool`)
   - Description: "Build a full-stack internal tool with database and auth"
   - Starter files: `app.py` (FastAPI), `frontend/index.html` (simple React via CDN), `requirements.txt`, `app.yaml`
   - CLAUDE.md: Lakebase/Postgres patterns, CRUD endpoints, auth flow
   - Suggested prompts: "Add a data entry form that saves to Lakebase", "Build an approval workflow with status tracking", "Add role-based access control"
   - Skills: databricks-app-python, databricks-unity-catalog, databricks-config

4. **Data pipeline** (`pipeline`)
   - Description: "Build and orchestrate Spark data pipelines"
   - Starter files: `pipeline.py` (DLT skeleton), `config.yml`, `README.md`
   - CLAUDE.md: DLT/SDP context, medallion architecture, scheduling
   - Suggested prompts: "Create a bronze-silver-gold pipeline for CSV ingestion", "Add data quality expectations and quarantine", "Schedule this pipeline to run hourly"
   - Skills: spark-declarative-pipelines, databricks-jobs, databricks-unity-catalog

5. **Blank project** (`blank`) - the existing behavior
   - Description: "Start from scratch with a blank workspace"
   - No starter files, default CLAUDE.md
   - Generic prompts: "Help me build an app on Databricks", "What can I build with Databricks?"

#### b) Update HomePage with template selector

Replace the plain text input with a two-step creation flow:

1. Show template cards in a grid (2 columns) with icon, name, description
2. Clicking a template opens a name input inline or in a small modal
3. Submitting creates the project with the template ID

Design: Each template card should be ~120px tall with a colored left border/accent, icon, name, and 1-line description. The "Blank project" card should be last and visually less prominent.

Keep the existing form as a fallback if JavaScript fails. The template cards should feel snappy - no loading states until after submit.

#### c) Update backend to accept template

Add `template` optional field to `CreateProjectRequest`:

```python
class CreateProjectRequest(BaseModel):
  name: str
  template: str | None = None
```

Pass template to `storage.create()`. In `ensure_project_directory()` / `_create_default_claude_md()`, if a template is provided:
- Write the template's starter files to the project directory
- Write the template-specific CLAUDE.md instead of the generic one

The template file contents should be defined in a new `server/services/templates.py` module that mirrors the frontend template definitions.

#### d) Update frontend API and context

- `createProject(name, template?)` in api.ts
- `createProject(name, template?)` in ProjectsContext
- `HomePage` passes selected template to createProject

### 2. Suggested prompts in Claude terminal

#### a) Pass template info to ProjectPage

The Project type needs a `template` field (optional string) so the ProjectPage knows which template was used.

#### b) Show starter prompts in ClaudeTerminal

When the Claude terminal first renders (before any session is created), show the template's suggested prompts as clickable cards/chips below the terminal header. Clicking a prompt should:
1. Create the PTY session (if not already created)
2. Type the prompt text into the terminal input

These prompts disappear once the user starts interacting with the terminal.

If ClaudeTerminal currently doesn't have an "empty state" before the PTY session, add a minimal welcome screen:
- Template name as header
- 3-4 suggested prompt chips
- A "Start Claude Code" button that creates the session

### 3. App preview panel

#### a) Add "Preview" tab to bottom panel

Add `'preview'` to the `BottomPanelTab` type:

```typescript
export type BottomPanelTab = 'terminal' | 'output' | 'deploy' | 'preview';
```

Add the tab in the BottomPanel tab bar with an Eye or Globe icon.

#### b) Create AppPreview component

Create `client/src/components/editor/AppPreview.tsx`:

- Shows an iframe that loads a configurable URL
- Default: the deployed app URL from deploy status (if available)
- Manual URL input bar at the top (like a browser address bar)
- Refresh button
- "Open in new tab" button
- Error state: "No app running. Deploy your app first or enter a URL."
- The iframe should have `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` for security

#### c) Wire into ProjectPage

In ProjectPage, add the preview tab content:

```typescript
const bottomPanelContent = bottomPanelTab === 'preview' ? (
  <AppPreview projectId={projectId} />
) : bottomPanelTab === 'terminal' ...
```

The AppPreview component should fetch the deploy status to get the `app_url` automatically.

### 4. Homepage showcase section (optional, low priority)

Below the template cards and above the project list, add a small "What you can build" section with 3 example screenshots or cards. This can be static images or just styled text cards. Keep it simple - just enough to inspire users.

## Technical constraints

- Do NOT add new npm dependencies (use existing lucide-react for icons, existing Tailwind for styling)
- Do NOT add new Python dependencies
- Template file contents should be minimal but functional (10-30 lines each, not full apps)
- Starter files should actually work if deployed as-is (valid Python, valid app.yaml)
- Python code style: 2-space indentation, single quotes, ruff-compatible
- TypeScript: follow existing patterns in the codebase
- Keep the iframe sandboxed for security
- Template data should be defined in both frontend (for display) and backend (for file creation)
- The preview iframe must handle cross-origin gracefully (Databricks Apps URLs are different origins)
- Do NOT modify ClaudeTerminal's PTY/polling logic - only add the welcome/empty state before the session starts

## Completion criteria

The task is COMPLETE when ALL of these are true:
- [ ] `client/src/lib/templates.ts` exists with 5 templates (chatbot, dashboard, internal-tool, pipeline, blank)
- [ ] Each template has: id, name, description, icon, color, starterFiles, claudeMd, suggestedPrompts, skills
- [ ] HomePage shows template cards in a grid layout
- [ ] Clicking a template + entering a name creates a project with that template
- [ ] `CreateProjectRequest` has an optional `template` field
- [ ] Backend writes template-specific starter files and CLAUDE.md to project directory
- [ ] `server/services/templates.py` exists with template file definitions
- [ ] ClaudeTerminal shows suggested prompts before session starts (when template is set)
- [ ] Clicking a suggested prompt starts the session and sends the text
- [ ] `BottomPanelTab` type includes 'preview'
- [ ] Preview tab shows in the bottom panel tab bar
- [ ] `AppPreview.tsx` exists with iframe, URL bar, refresh, and open-in-new-tab
- [ ] AppPreview loads the deployed app URL when available
- [ ] Project type includes optional `template` field
- [ ] No TypeScript errors: `cd client && npx tsc --noEmit`
- [ ] No Python linting errors: `uvx ruff check server/services/templates.py server/routers/projects.py`
- [ ] No Python formatting errors: `uvx ruff format --check server/services/templates.py server/routers/projects.py`

## Instructions

1. Read all context files listed above
2. Create `client/src/lib/templates.ts` with template definitions
3. Create `server/services/templates.py` with backend template file contents
4. Update `server/routers/projects.py` to accept template field
5. Update `server/services/backup_manager.py` to write template files
6. Update `client/src/lib/api.ts` and `client/src/contexts/ProjectsContext.tsx` for template param
7. Rewrite `HomePage.tsx` with template card selector
8. Add welcome/prompt screen to `ClaudeTerminal.tsx`
9. Add 'preview' to `BottomPanelTab` type
10. Create `client/src/components/editor/AppPreview.tsx`
11. Wire preview into `ProjectPage.tsx` bottom panel
12. Run TypeScript check: `cd client && npx tsc --noEmit`
13. Run Python lint: `uvx ruff check server/services/templates.py server/routers/projects.py && uvx ruff format --check server/services/templates.py server/routers/projects.py`

When ALL completion criteria are verified, output:
<promise>TASK COMPLETE</promise>

IMPORTANT:
- Only output the promise when you have VERIFIED all criteria
- Do NOT output the promise prematurely
- If stuck after multiple attempts, document blockers instead
