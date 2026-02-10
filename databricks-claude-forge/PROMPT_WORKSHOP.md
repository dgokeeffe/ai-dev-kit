# Task: Set up Claude Code CLI environment with skills, workspace sync, and micro editor

## Objective

When the Claude Code CLI launches in the terminal, it currently has only auth env vars - no skills, no CLAUDE.md config, no MCP servers, no workspace sync, and no terminal text editor. Set up the PTY environment so users get the full Claude Code experience with Databricks skills, automatic workspace sync via git hooks, and the micro text editor for in-terminal editing.

## Context

Read these files:
- `server/routers/pty.py` - PTY spawn logic (after HTTP polling rewrite). Look at `_build_claude_env()` and the fork/exec section
- `server/services/skills_manager.py` - How skills are loaded and copied
- `server/services/backup_manager.py` - `_create_default_claude_md()` and `ensure_project_directory()`
- `skills/` - Available Databricks skills (5 skills with SKILL.md files)
- `server/services/system_prompt.py` - `get_available_skills()` for reference
- `app.yaml` - ENABLED_SKILLS env var lists all skills to enable

Reference implementation (how claude-code-cli-bricks does it):
- https://github.com/datasciencemonkey/claude-code-cli-bricks/blob/main/setup_claude.py
- https://github.com/datasciencemonkey/claude-code-cli-bricks/blob/main/setup_databricks.py
- https://github.com/datasciencemonkey/claude-code-cli-bricks/blob/main/sync_to_workspace.py

## Requirements

### 1. Claude Code CLI setup script

Create `server/services/claude_setup.py` - a module that prepares the environment before Claude Code CLI is spawned in the PTY. Called from pty.py right before the fork/exec.

**What it does:**

#### a) Write `~/.claude/settings.json` for the PTY process

This configures Claude Code CLI to use Databricks Foundation Model API:

```python
def setup_claude_settings(home_dir: str, host: str, token: str, model: str = 'databricks-claude-sonnet-4-5'):
  """Write Claude Code settings for Databricks auth."""
  claude_dir = os.path.join(home_dir, '.claude')
  os.makedirs(claude_dir, exist_ok=True)

  settings = {
    'env': {
      'ANTHROPIC_AUTH_TOKEN': token,
      'ANTHROPIC_BASE_URL': f'{host.rstrip("/")}/serving-endpoints/anthropic',
      'ANTHROPIC_MODEL': model,
      'ANTHROPIC_CUSTOM_HEADERS': 'x-databricks-disable-beta-headers: true',
      'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS': '1',
    },
    'permissions': {
      'allow': [
        'Bash',
        'Read',
        'Write',
        'Edit',
        'Glob',
        'Grep',
        'Skill',
      ],
    },
  }

  settings_path = os.path.join(claude_dir, 'settings.json')
  with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)
```

#### b) Copy skills into project `.claude/skills/` directory

This should already happen via `ensure_project_directory()` but verify and ensure all skills from the `skills/` directory are copied.

#### c) Write a project CLAUDE.md with Databricks context

Enhance the existing `_create_default_claude_md()` to include:
- Available Databricks tools (execute_sql, upload_file, etc.)
- Available skills list with descriptions
- Databricks workspace URL for reference
- User's catalog/schema if configured
- Instructions for using the Skill tool

```markdown
# Project context

## Databricks workspace
- Host: {workspace_url}

## Available tools
You have access to Databricks tools via the CLI:
- `execute_sql` - Run SQL queries on Databricks
- `upload_file` / `upload_folder` - Upload files to workspace
- `create_or_update_pipeline` - Manage Spark declarative pipelines
- `run_python_file_on_databricks` - Execute Python on clusters

## Available skills
Load skills with the `/skill` command:
{skill_list_with_descriptions}

## Workspace sync
Files are automatically synced to `/Workspace/Users/{user_email}/projects/{project_name}/` on each git commit.
```

#### d) Configure git identity and workspace sync hook

```python
def setup_git_config(project_dir: str, user_email: str, workspace_url: str, token: str):
  """Configure git identity and workspace sync hook."""
  import subprocess

  # Set git identity
  subprocess.run(['git', 'config', 'user.email', user_email], cwd=project_dir, capture_output=True)
  subprocess.run(['git', 'config', 'user.name', user_email.split('@')[0]], cwd=project_dir, capture_output=True)

  # Initialize git repo if not already
  if not os.path.exists(os.path.join(project_dir, '.git')):
    subprocess.run(['git', 'init'], cwd=project_dir, capture_output=True)
    subprocess.run(['git', 'add', '.'], cwd=project_dir, capture_output=True)
    subprocess.run(['git', 'commit', '-m', 'Initial project setup'], cwd=project_dir, capture_output=True)

  # Write post-commit hook for workspace sync
  hooks_dir = os.path.join(project_dir, '.git', 'hooks')
  os.makedirs(hooks_dir, exist_ok=True)

  hook_script = f'''#!/bin/bash
# Auto-sync to Databricks Workspace on commit
PROJECT_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKSPACE_PATH="/Workspace/Users/{user_email}/projects/$PROJECT_NAME"

# Only sync if databricks CLI is available
if command -v databricks &> /dev/null; then
  databricks workspace import-dir "$(git rev-parse --show-toplevel)" "$WORKSPACE_PATH" --overwrite 2>/dev/null &
  echo "Syncing to $WORKSPACE_PATH..."
fi
'''

  hook_path = os.path.join(hooks_dir, 'post-commit')
  with open(hook_path, 'w') as f:
    f.write(hook_script)
  os.chmod(hook_path, 0o755)
```

#### e) Write `~/.databrickscfg` for CLI access

```python
def setup_databricks_config(home_dir: str, host: str, token: str):
  """Write Databricks CLI config."""
  config_content = f'''[DEFAULT]
host = {host}
token = {token}
'''
  config_path = os.path.join(home_dir, '.databrickscfg')
  with open(config_path, 'w') as f:
    f.write(config_content)
```

### 2. Install micro text editor

In the PTY spawn setup (or at app startup), install the `micro` terminal text editor:

```python
def ensure_micro_installed(home_dir: str):
  """Install micro text editor if not present."""
  micro_path = os.path.join(home_dir, '.local', 'bin', 'micro')
  if os.path.exists(micro_path):
    return micro_path

  os.makedirs(os.path.join(home_dir, '.local', 'bin'), exist_ok=True)

  # Download and install micro
  import subprocess
  result = subprocess.run(
    ['bash', '-c', 'curl -fsSL https://getmic.ro | bash'],
    cwd=os.path.join(home_dir, '.local', 'bin'),
    capture_output=True,
    timeout=30,
  )

  if os.path.exists(micro_path):
    return micro_path
  return None
```

Add `~/.local/bin` to the PATH in `_build_claude_env()` so micro is available.

### 3. Integrate setup into PTY spawn

In `server/routers/pty.py`, call the setup functions BEFORE the fork/exec:

```python
from ..services.claude_setup import (
  setup_claude_settings,
  setup_databricks_config,
  setup_git_config,
  ensure_micro_installed,
  write_project_claude_md,
)

# In the create session endpoint, before spawning PTY:
home_dir = os.environ.get('HOME', '/tmp')

# Set up Claude Code CLI config
if host and token:
  setup_claude_settings(home_dir, host, token)
  setup_databricks_config(home_dir, host, token)

# Set up git and workspace sync
setup_git_config(project_dir, user_email, host or '', token or '')

# Write enhanced CLAUDE.md
write_project_claude_md(project_dir, host, user_email, skills)

# Ensure micro is installed
ensure_micro_installed(home_dir)

# Add micro to PATH
env['PATH'] = f'{home_dir}/.local/bin:{env.get("PATH", "")}'
```

### 4. Workspace sync API endpoint (optional, for manual sync)

Add an endpoint to `server/routers/git.py` or a new router:

```
POST /api/projects/{project_id}/sync-to-workspace
```

- Gets user email and workspace URL
- Runs `databricks workspace import-dir {project_dir} /Workspace/Users/{email}/projects/{name} --overwrite`
- Returns status

This gives users a "Sync to Workspace" button in addition to the automatic git hook.

## Technical constraints

- Do NOT change the HTTP polling terminal endpoints (those were just rewritten)
- Do NOT add new Python dependencies (use subprocess for CLI tools)
- Setup functions should be idempotent (safe to call multiple times)
- Setup should be fast (<5 seconds) - don't block session creation
- The micro install can happen once at app startup, not per-session
- Git operations should use the project directory, not the global git config
- Write setup files atomically where possible (write to temp, then rename)
- Python code style: 2-space indentation, single quotes, ruff-compatible

## Completion criteria

The task is COMPLETE when ALL of these are true:
- [ ] `server/services/claude_setup.py` exists with all setup functions
- [ ] `~/.claude/settings.json` is written before Claude Code CLI starts
- [ ] `~/.databrickscfg` is written with workspace host and token
- [ ] Skills are present in project `.claude/skills/` directory
- [ ] Enhanced CLAUDE.md exists in project directory with tools/skills documentation
- [ ] Git identity is configured in the project (user.email, user.name)
- [ ] Git post-commit hook syncs to `/Workspace/Users/{email}/projects/{name}/`
- [ ] Micro text editor is installed and available in PATH
- [ ] `_build_claude_env()` includes `~/.local/bin` in PATH
- [ ] Setup is called before PTY fork/exec in the create session endpoint
- [ ] Setup functions are idempotent (can be called repeatedly without issues)
- [ ] No Python linting errors: `uvx ruff check server/services/claude_setup.py server/routers/pty.py`
- [ ] No Python formatting errors: `uvx ruff format --check server/services/claude_setup.py server/routers/pty.py`

## Instructions

1. Read all context files
2. Create `server/services/claude_setup.py` with all setup functions
3. Update `server/routers/pty.py` to call setup before PTY spawn
4. Update `_build_claude_env()` to include `~/.local/bin` in PATH
5. Add micro installation at app startup in `server/app.py` (one-time)
6. Optionally add a sync-to-workspace endpoint
7. Run linting: `uvx ruff check server/services/claude_setup.py server/routers/pty.py`
8. Test locally if dev servers are running

When ALL completion criteria are verified, output:
<promise>TASK COMPLETE</promise>

IMPORTANT:
- Only output the promise when you have VERIFIED all criteria
- Do NOT output the promise prematurely
- If stuck after multiple attempts, document blockers instead
