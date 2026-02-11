"""Claude Code CLI environment setup for workshop PTY sessions.

Prepares the environment before each Claude Code CLI session is spawned:
  - Writes ~/.claude/settings.json for Databricks Foundation Model API auth
  - Writes ~/.databrickscfg for CLI access
  - Configures git identity
  - Writes a workshop-specific CLAUDE.md with challenge description and skills
  - Copies skills into the session workspace
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Claude Code CLI settings
# ---------------------------------------------------------------------------


def setup_claude_settings(
    home_dir: str,
    host: str,
    token: str,
    model: str = "databricks-claude-sonnet-4-5",
) -> None:
    """Write Claude Code CLI settings for Databricks FMAPI auth.

    Creates ~/.claude/settings.json pointing Claude Code at the Databricks
    Foundation Model API endpoint.
    """
    claude_dir = os.path.join(home_dir, ".claude")
    os.makedirs(claude_dir, exist_ok=True)

    auth_token = os.environ.get("CLAUDE_API_TOKEN") or token
    if not auth_token:
        logger.warning("No auth token available for Claude settings")
        return

    settings = {
        "env": {
            "ANTHROPIC_AUTH_TOKEN": auth_token,
            "ANTHROPIC_BASE_URL": f"{host.rstrip('/')}/serving-endpoints/anthropic",
            "ANTHROPIC_MODEL": model,
            "ANTHROPIC_CUSTOM_HEADERS": "x-databricks-disable-beta-headers: true",
            "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
        },
        "permissions": {
            "allow": [
                "Bash",
                "Read",
                "Write",
                "Edit",
                "Glob",
                "Grep",
                "Skill",
            ],
        },
    }

    settings_path = os.path.join(claude_dir, "settings.json")
    _atomic_write_json(settings_path, settings)
    token_source = (
        "CLAUDE_API_TOKEN" if os.environ.get("CLAUDE_API_TOKEN") else "forwarded token"
    )
    logger.info("Wrote Claude settings to %s (using %s)", settings_path, token_source)


# ---------------------------------------------------------------------------
# Databricks CLI config
# ---------------------------------------------------------------------------


def setup_databricks_config(home_dir: str, host: str, token: str) -> None:
    """Write ~/.databrickscfg for Databricks CLI access."""
    config_content = f"[DEFAULT]\nhost = {host}\ntoken = {token}\n"
    config_path = os.path.join(home_dir, ".databrickscfg")
    _atomic_write_text(config_path, config_content)
    logger.info("Wrote Databricks config to %s", config_path)


# ---------------------------------------------------------------------------
# Git identity
# ---------------------------------------------------------------------------


def setup_git_config(project_dir: str, user_email: str) -> None:
    """Set git identity in the session workspace and initialize if needed."""
    project_path = Path(project_dir)
    git_dir = project_path / ".git"

    if not git_dir.exists():
        _run_quiet(["git", "init"], cwd=project_dir)
        _run_quiet(["git", "add", "."], cwd=project_dir)
        _run_quiet(
            ["git", "commit", "-m", "Initial workshop setup", "--allow-empty"],
            cwd=project_dir,
        )

    username = user_email.split("@")[0] if "@" in user_email else user_email
    _run_quiet(["git", "config", "user.email", user_email], cwd=project_dir)
    _run_quiet(["git", "config", "user.name", username], cwd=project_dir)
    logger.info("Configured git identity for %s in %s", user_email, project_dir)


# ---------------------------------------------------------------------------
# Workshop CLAUDE.md
# ---------------------------------------------------------------------------


def write_workshop_claude_md(
    project_dir: str,
    workspace_url: str | None,
    user_email: str,
    session_name: str,
    skills: list[dict] | None = None,
) -> None:
    """Write a workshop-specific CLAUDE.md with challenge context.

    Only writes if CLAUDE.md does not already exist (idempotent).
    """
    claude_md_path = os.path.join(project_dir, "CLAUDE.md")
    if os.path.exists(claude_md_path):
        return

    skill_lines = ""
    if skills:
        entries = [f"- **{s['name']}**: {s.get('description', '')}" for s in skills]
        skill_lines = "\n".join(entries)

    content = f"""# Vibe Coding Workshop

## Session: {session_name}
## User: {user_email}

## Databricks Workspace
- Host: {workspace_url or "(not configured)"}

## Workshop Challenge

Build a complete data platform on Databricks:

1. **Data Pipeline** - Create a Lakeflow Declarative Pipeline (bronze -> silver -> gold)
2. **Analytics App** - Build a Dash or Streamlit app that queries your pipeline output
3. **AI App** - Build an app that uses Databricks Foundation Model API

## Available Tools

You have access to Databricks tools via the CLI:
- `databricks` CLI for workspace, jobs, pipelines, and apps
- `execute_sql` / SQL queries via `databricks sql`
- File uploads via `databricks workspace import`

## Available Skills

Load skills with the Skill tool:
{skill_lines}

## Tips

- Use `databricks apps deploy <name> --json '{{"git_source": ...}}'` for git-based app deployment
- Run `dbx-new <template>` to scaffold app projects (streamlit, dash, flask)
- Run `dbx-deploy <app-name>` to deploy the current directory as an app
- Commit frequently - files sync to your workspace on commit

## Resources Created

### Tables
(none yet)

### Pipelines
(none yet)

### Apps
(none yet)
"""

    _atomic_write_text(claude_md_path, content)
    logger.info("Wrote workshop CLAUDE.md to %s", claude_md_path)


# ---------------------------------------------------------------------------
# Skills management
# ---------------------------------------------------------------------------


def copy_skills_to_session(
    session_workspace: Path,
    skills_source: Path,
) -> int:
    """Copy skills into a session's .claude/skills/ directory.

    Returns the number of skills copied.
    """
    if not skills_source.exists():
        logger.warning("Skills source not found: %s", skills_source)
        return 0

    dest = session_workspace / ".claude" / "skills"
    dest.mkdir(parents=True, exist_ok=True)

    copied = 0
    for skill_dir in skills_source.iterdir():
        if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
            skill_dest = dest / skill_dir.name
            if skill_dest.exists():
                shutil.rmtree(skill_dest)
            shutil.copytree(skill_dir, skill_dest)
            copied += 1

    logger.info("Copied %d skills to %s", copied, dest)
    return copied


def get_available_skills(skills_dir: Path) -> list[dict]:
    """Parse skill metadata from a skills directory."""
    skills: list[dict] = []
    if not skills_dir.exists():
        return skills

    for skill_dir in skills_dir.iterdir():
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        try:
            content = skill_md.read_text()
            if content.startswith("---"):
                end_idx = content.find("---", 3)
                if end_idx > 0:
                    frontmatter = content[3:end_idx].strip()
                    name = None
                    description = None
                    for line in frontmatter.split("\n"):
                        if line.startswith("name:"):
                            name = line.split(":", 1)[1].strip().strip("\"'")
                        elif line.startswith("description:"):
                            description = line.split(":", 1)[1].strip().strip("\"'")
                    if name:
                        skills.append({"name": name, "description": description or ""})
        except Exception as e:
            logger.warning("Failed to parse skill %s: %s", skill_dir, e)

    return skills


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def prepare_session_environment(
    home_dir: str,
    session_workspace: str | Path,
    host: str | None,
    token: str | None,
    user_email: str,
    session_name: str,
    skills_source: str | Path | None = None,
) -> None:
    """Run all setup steps before PTY spawn.

    This is the main entry point called from the session manager before
    creating a new Claude Code PTY session.
    """
    # Ensure Path objects for path operations
    ws_path = (
        Path(session_workspace)
        if not isinstance(session_workspace, Path)
        else session_workspace
    )
    sk_path = (
        Path(skills_source)
        if skills_source and not isinstance(skills_source, Path)
        else skills_source
    )

    try:
        if host and token:
            setup_claude_settings(home_dir, host, token)
            setup_databricks_config(home_dir, host, token)

        setup_git_config(str(ws_path), user_email)

        skills: list[dict] = []
        if sk_path:
            copy_skills_to_session(ws_path, sk_path)
            skills = get_available_skills(sk_path)

        write_workshop_claude_md(
            str(ws_path),
            host,
            user_email,
            session_name,
            skills,
        )
    except Exception as e:
        logger.error("Session environment setup error (non-fatal): %s", e)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _atomic_write_text(path: str, content: str) -> None:
    dir_name = os.path.dirname(path)
    try:
        fd, tmp_path = tempfile.mkstemp(dir=dir_name, prefix=".tmp_")
        try:
            os.write(fd, content.encode("utf-8"))
        finally:
            os.close(fd)
        os.replace(tmp_path, path)
    except Exception:
        with open(path, "w") as f:
            f.write(content)


def _atomic_write_json(path: str, data: dict) -> None:
    _atomic_write_text(path, json.dumps(data, indent=2) + "\n")


def _run_quiet(cmd: list[str], cwd: str) -> None:
    try:
        subprocess.run(cmd, cwd=cwd, capture_output=True, timeout=10)
    except Exception as e:
        logger.debug("Command %s failed (non-fatal): %s", cmd[0], e)
