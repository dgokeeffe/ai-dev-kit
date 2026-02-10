"""Claude Code CLI environment setup for PTY sessions.

Prepares the environment before Claude Code CLI is spawned in the PTY:
- Writes ~/.claude/settings.json for Databricks Foundation Model API auth
- Writes ~/.databrickscfg for CLI access
- Configures git identity and workspace sync hook
- Writes an enhanced project CLAUDE.md with tools/skills documentation
- Installs the micro text editor
"""

import json
import logging
import os
import stat
import subprocess
import tempfile
from pathlib import Path

from .skills_manager import get_available_skills

logger = logging.getLogger(__name__)


def setup_claude_settings(
  home_dir: str,
  host: str,
  token: str,
  model: str = 'databricks-claude-sonnet-4-5',
) -> None:
  """Write Claude Code CLI settings for Databricks auth.

  Creates ~/.claude/settings.json with Anthropic env vars pointing
  to the Databricks Foundation Model API endpoint.

  Uses CLAUDE_API_TOKEN env var if available (preferred), otherwise falls
  back to the provided token parameter.

  Args:
      home_dir: Home directory path
      host: Databricks workspace URL
      token: Databricks access token (fallback if CLAUDE_API_TOKEN not set)
      model: Model name to use (default: databricks-claude-sonnet-4-5)
  """
  claude_dir = os.path.join(home_dir, '.claude')
  os.makedirs(claude_dir, exist_ok=True)

  # Use dedicated CLAUDE_API_TOKEN if available (avoids OAuth scope issues)
  auth_token = os.environ.get('CLAUDE_API_TOKEN') or token

  if not auth_token:
    logger.warning('No auth token available for Claude settings')
    return

  settings = {
    'env': {
      'ANTHROPIC_AUTH_TOKEN': auth_token,
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
  _atomic_write_json(settings_path, settings)

  token_source = 'CLAUDE_API_TOKEN' if os.environ.get('CLAUDE_API_TOKEN') else 'fallback token'
  logger.info(f'Wrote Claude settings to {settings_path} (using {token_source})')


def setup_databricks_config(home_dir: str, host: str, token: str) -> None:
  """Write Databricks CLI config file.

  Creates ~/.databrickscfg with host and token for CLI access.

  Args:
      home_dir: Home directory path
      host: Databricks workspace URL
      token: Databricks access token
  """
  config_content = f'[DEFAULT]\nhost = {host}\ntoken = {token}\n'
  config_path = os.path.join(home_dir, '.databrickscfg')
  _atomic_write_text(config_path, config_content)
  logger.info(f'Wrote Databricks config to {config_path}')


def setup_git_config(
  project_dir: str,
  user_email: str,
  workspace_url: str,
  token: str,
) -> None:
  """Configure git identity and workspace sync hook.

  Sets git user.email and user.name in the project repo, initializes
  the repo if needed, and installs a post-commit hook that syncs
  files to the Databricks Workspace.

  Args:
      project_dir: Path to the project directory
      user_email: User email for git identity
      workspace_url: Databricks workspace URL (for hook env)
      token: Databricks token (for hook env)
  """
  project_path = Path(project_dir)

  # Initialize git repo if not already
  git_dir = project_path / '.git'
  if not git_dir.exists():
    _run_quiet(['git', 'init'], cwd=project_dir)
    _run_quiet(['git', 'add', '.'], cwd=project_dir)
    _run_quiet(['git', 'commit', '-m', 'Initial project setup', '--allow-empty'], cwd=project_dir)

  # Set git identity (project-local, not global)
  username = user_email.split('@')[0] if '@' in user_email else user_email
  _run_quiet(['git', 'config', 'user.email', user_email], cwd=project_dir)
  _run_quiet(['git', 'config', 'user.name', username], cwd=project_dir)

  # Write post-commit hook for workspace sync
  hooks_dir = git_dir / 'hooks'
  hooks_dir.mkdir(parents=True, exist_ok=True)

  hook_script = (
    '#!/bin/bash\n'
    '# Auto-sync to Databricks Workspace on commit\n'
    'PROJECT_NAME=$(basename "$(git rev-parse --show-toplevel)")\n'
    f'WORKSPACE_PATH="/Workspace/Users/{user_email}/projects/$PROJECT_NAME"\n'
    'ROOT=$(git rev-parse --show-toplevel)\n'
    '\n'
    '# Only sync if databricks CLI is available\n'
    'if command -v databricks &> /dev/null; then\n'
    '  databricks workspace import-dir "$ROOT" "$WORKSPACE_PATH" '
    '--overwrite 2>/dev/null &\n'
    '  echo "Syncing to $WORKSPACE_PATH..."\n'
    'fi\n'
  )

  hook_path = hooks_dir / 'post-commit'
  _atomic_write_text(str(hook_path), hook_script)
  os.chmod(str(hook_path), stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
  logger.info(f'Installed post-commit hook in {hook_path}')


def write_project_claude_md(
  project_dir: str,
  workspace_url: str | None,
  user_email: str,
  skills: list[dict] | None = None,
) -> None:
  """Write an enhanced CLAUDE.md with Databricks context.

  Only writes if CLAUDE.md does not already exist (idempotent).

  Args:
      project_dir: Path to the project directory
      workspace_url: Databricks workspace URL
      user_email: User email for workspace paths
      skills: List of skill dicts with 'name' and 'description' keys.
              If None, loads from skills_manager.
  """
  claude_md_path = os.path.join(project_dir, 'CLAUDE.md')
  if os.path.exists(claude_md_path):
    return

  if skills is None:
    skills = get_available_skills()

  skill_lines = ''
  if skills:
    entries = [f'- **{s["name"]}**: {s.get("description", "")}' for s in skills]
    skill_lines = '\n'.join(entries)

  content = f"""# Project context

## Databricks workspace
- Host: {workspace_url or '(not configured)'}

## Available tools
You have access to Databricks tools via the CLI:
- `execute_sql` / `execute_sql_multi` - Run SQL queries on Databricks
- `upload_file` / `upload_folder` - Upload files to workspace
- `create_or_update_pipeline` / `start_update` - Manage Spark declarative pipelines
- `run_python_file_on_databricks` / `execute_databricks_command` - Execute Python on clusters

## Available skills
Load skills with the `/skill` command:
{skill_lines}

## Workspace sync
Files are automatically synced to `/Workspace/Users/{user_email}/projects/` on each git commit.

## Resources created

### Tables
(none yet)

### Volumes
(none yet)

### Pipelines
(none yet)

### Jobs
(none yet)

## Notes

Add any project-specific notes or context here.
"""

  _atomic_write_text(claude_md_path, content)
  logger.info(f'Wrote enhanced CLAUDE.md to {claude_md_path}')


def ensure_micro_installed(home_dir: str) -> str | None:
  """Install micro text editor if not present.

  Downloads micro to ~/.local/bin/ using the official installer script.

  Args:
      home_dir: Home directory path

  Returns:
      Path to the micro binary, or None if installation failed
  """
  bin_dir = os.path.join(home_dir, '.local', 'bin')
  micro_path = os.path.join(bin_dir, 'micro')

  if os.path.exists(micro_path) and os.access(micro_path, os.X_OK):
    logger.debug(f'micro already installed at {micro_path}')
    return micro_path

  os.makedirs(bin_dir, exist_ok=True)

  try:
    result = subprocess.run(
      ['bash', '-c', 'curl -fsSL https://getmic.ro | bash'],
      cwd=bin_dir,
      capture_output=True,
      timeout=30,
    )
    if os.path.exists(micro_path) and os.access(micro_path, os.X_OK):
      logger.info(f'Installed micro to {micro_path}')
      return micro_path
    stderr_msg = result.stderr.decode(errors='replace')
    logger.warning(f'micro install ran but binary not found: {stderr_msg}')
  except subprocess.TimeoutExpired:
    logger.warning('micro install timed out after 30s')
  except Exception as e:
    logger.warning(f'Failed to install micro: {e}')

  return None


def prepare_pty_environment(
  home_dir: str,
  project_dir: str,
  host: str | None,
  token: str | None,
  user_email: str,
) -> None:
  """Run all setup steps before PTY spawn.

  This is the main entry point called from pty.py. It orchestrates
  all the individual setup functions.

  Args:
      home_dir: Home directory path
      project_dir: Path to the project directory
      host: Databricks workspace URL (may be None)
      token: Databricks access token (may be None)
      user_email: User email address
  """
  try:
    # Configure Claude Code CLI and Databricks CLI
    if host and token:
      setup_claude_settings(home_dir, host, token)
      setup_databricks_config(home_dir, host, token)

    # Configure git identity and workspace sync hook
    setup_git_config(project_dir, user_email, host or '', token or '')

    # Write enhanced CLAUDE.md (only if it doesn't exist)
    skills = get_available_skills()
    write_project_claude_md(project_dir, host, user_email, skills)

  except Exception as e:
    # Setup failures should not block session creation
    logger.error(f'PTY environment setup error (non-fatal): {e}')


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _atomic_write_text(path: str, content: str) -> None:
  """Write text to a file atomically via temp file + rename.

  Args:
      path: Destination file path
      content: Text content to write
  """
  dir_name = os.path.dirname(path)
  try:
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, prefix='.tmp_')
    try:
      os.write(fd, content.encode('utf-8'))
    finally:
      os.close(fd)
    os.replace(tmp_path, path)
  except Exception:
    # Fall back to direct write if atomic write fails (e.g. cross-device)
    with open(path, 'w') as f:
      f.write(content)


def _atomic_write_json(path: str, data: dict) -> None:
  """Write JSON to a file atomically via temp file + rename.

  Args:
      path: Destination file path
      data: Dictionary to serialize as JSON
  """
  _atomic_write_text(path, json.dumps(data, indent=2) + '\n')


def _run_quiet(cmd: list[str], cwd: str) -> None:
  """Run a subprocess, suppressing output. Errors are logged but not raised.

  Args:
      cmd: Command and arguments
      cwd: Working directory
  """
  try:
    subprocess.run(cmd, cwd=cwd, capture_output=True, timeout=10)
  except Exception as e:
    logger.debug(f'Command {cmd[0]} failed (non-fatal): {e}')
