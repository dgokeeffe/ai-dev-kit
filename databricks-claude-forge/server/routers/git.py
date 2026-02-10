"""Git operations endpoints for source control UI.

Provides git status, diff, staging, commit, branch, push/pull, and log
for project directories. All endpoints shell out to git CLI.
"""

import asyncio
import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from ..services.backup_manager import ensure_project_directory
from ..services.storage import ProjectStorage
from ..services.user import get_current_user, get_workspace_url
from .files import _validate_path

logger = logging.getLogger(__name__)
router = APIRouter()


async def _get_project_dir(request: Request, project_id: str) -> Path:
  """Verify project access and return project directory."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)
  project = await storage.get(project_id)
  if not project:
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')
  return ensure_project_directory(project_id)


async def _run_git(project_dir: Path, *args: str) -> tuple[str, str, int]:
  """Run a git command in the project directory.

  Returns:
    Tuple of (stdout, stderr, returncode)
  """
  proc = await asyncio.create_subprocess_exec(
    'git',
    *args,
    cwd=str(project_dir),
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
    env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'},
  )
  stdout, stderr = await proc.communicate()
  return (
    stdout.decode('utf-8', errors='replace'),
    stderr.decode('utf-8', errors='replace'),
    proc.returncode or 0,
  )


async def _ensure_git_repo(project_dir: Path) -> None:
  """Ensure the project directory is a git repo, initialize if not."""
  git_dir = project_dir / '.git'
  if not git_dir.exists():
    stdout, stderr, rc = await _run_git(project_dir, 'init')
    if rc != 0:
      raise HTTPException(status_code=500, detail=f'Failed to init git repo: {stderr}')


def _parse_status_line(line: str) -> dict | None:
  """Parse a single git status --porcelain=v1 line."""
  if len(line) < 4:
    return None
  index_status = line[0]
  work_status = line[1]
  path = line[3:]

  # Determine overall status
  if index_status == '?' and work_status == '?':
    status = 'untracked'
  elif index_status in ('A', 'M', 'D', 'R', 'C') and work_status == ' ':
    status = 'staged'
  elif work_status in ('M', 'D'):
    if index_status in ('A', 'M', 'D', 'R', 'C'):
      status = 'staged+modified'
    else:
      status = 'modified'
  elif index_status == 'A':
    status = 'staged'
  else:
    status = 'modified'

  # Determine the change type character
  if index_status == '?' and work_status == '?':
    change_type = 'U'  # Untracked
  elif index_status == 'A' or (index_status == ' ' and work_status == 'A'):
    change_type = 'A'
  elif index_status == 'D' or work_status == 'D':
    change_type = 'D'
  elif index_status == 'R':
    change_type = 'R'
  else:
    change_type = 'M'

  return {
    'path': path,
    'status': status,
    'index_status': index_status,
    'work_status': work_status,
    'change_type': change_type,
  }


# --- Request models ---


class StageRequest(BaseModel):
  """Request model for staging/unstaging files."""

  files: list[str]


class CommitRequest(BaseModel):
  """Request model for creating a commit."""

  message: str


class CheckoutRequest(BaseModel):
  """Request model for switching branches."""

  branch: str


# --- Endpoints ---


@router.get('/projects/{project_id}/git/status')
async def git_status(request: Request, project_id: str):
  """Get git status for the project."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  # Get porcelain status
  stdout, stderr, rc = await _run_git(project_dir, 'status', '--porcelain=v1')
  if rc != 0:
    raise HTTPException(status_code=500, detail=f'git status failed: {stderr}')

  files = []
  for line in stdout.splitlines():
    parsed = _parse_status_line(line)
    if parsed:
      files.append(parsed)

  # Get current branch
  branch_out, _, _ = await _run_git(project_dir, 'rev-parse', '--abbrev-ref', 'HEAD')
  current_branch = branch_out.strip() or 'main'

  # Get ahead/behind counts (may fail if no remote)
  ahead = 0
  behind = 0
  tracking_ref = f'{current_branch}...origin/{current_branch}'
  rev_out, _, rev_rc = await _run_git(
    project_dir, 'rev-list', '--left-right', '--count', tracking_ref
  )
  if rev_rc == 0 and rev_out.strip():
    parts = rev_out.strip().split('\t')
    if len(parts) == 2:
      ahead = int(parts[0])
      behind = int(parts[1])

  return {
    'branch': current_branch,
    'files': files,
    'ahead': ahead,
    'behind': behind,
  }


@router.get('/projects/{project_id}/git/diff')
async def git_diff(
  request: Request,
  project_id: str,
  file: str = Query(..., description='File path to diff'),
  staged: bool = Query(False, description='Show staged diff'),
):
  """Get diff for a specific file."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  args = ['diff']
  if staged:
    args.append('--cached')
  args.append('--')
  args.append(file)

  stdout, stderr, rc = await _run_git(project_dir, *args)

  # If no diff (e.g., untracked file), show the full file content
  if not stdout.strip():
    file_path = _validate_path(project_dir, file)
    if file_path.exists() and file_path.is_file():
      try:
        content = file_path.read_text(encoding='utf-8')
        # Format as a new file diff
        lines = content.splitlines()
        diff_lines = ['--- /dev/null', f'+++ b/{file}', f'@@ -0,0 +1,{len(lines)} @@']
        for line in lines:
          diff_lines.append(f'+{line}')
        stdout = '\n'.join(diff_lines) + '\n'
      except Exception:
        stdout = ''

  return {
    'diff': stdout,
    'file': file,
  }


@router.post('/projects/{project_id}/git/stage')
async def git_stage(request: Request, project_id: str, body: StageRequest):
  """Stage files for commit."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  if not body.files:
    raise HTTPException(status_code=400, detail='No files specified')

  stdout, stderr, rc = await _run_git(project_dir, 'add', '--', *body.files)
  if rc != 0:
    raise HTTPException(status_code=500, detail=f'git add failed: {stderr}')

  return {'success': True, 'staged': body.files}


@router.post('/projects/{project_id}/git/unstage')
async def git_unstage(request: Request, project_id: str, body: StageRequest):
  """Unstage files."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  if not body.files:
    raise HTTPException(status_code=400, detail='No files specified')

  stdout, stderr, rc = await _run_git(project_dir, 'reset', 'HEAD', '--', *body.files)
  if rc != 0:
    raise HTTPException(status_code=500, detail=f'git reset failed: {stderr}')

  return {'success': True, 'unstaged': body.files}


@router.post('/projects/{project_id}/git/commit')
async def git_commit(request: Request, project_id: str, body: CommitRequest):
  """Create a commit."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  if not body.message.strip():
    raise HTTPException(status_code=400, detail='Commit message cannot be empty')

  stdout, stderr, rc = await _run_git(project_dir, 'commit', '-m', body.message)
  if rc != 0:
    raise HTTPException(status_code=500, detail=f'git commit failed: {stderr}')

  return {'success': True, 'output': stdout.strip()}


@router.get('/projects/{project_id}/git/branches')
async def git_branches(request: Request, project_id: str):
  """List branches."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  stdout, stderr, rc = await _run_git(project_dir, 'branch', '-a', '--no-color')

  branches = []
  current = None
  for line in stdout.splitlines():
    line = line.strip()
    if not line:
      continue
    is_current = line.startswith('* ')
    name = line.lstrip('* ').strip()
    if is_current:
      current = name
    branches.append({'name': name, 'current': is_current})

  return {'branches': branches, 'current': current}


@router.post('/projects/{project_id}/git/checkout')
async def git_checkout(request: Request, project_id: str, body: CheckoutRequest):
  """Switch branch."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  if not body.branch.strip():
    raise HTTPException(status_code=400, detail='Branch name cannot be empty')

  stdout, stderr, rc = await _run_git(project_dir, 'checkout', body.branch)
  if rc != 0:
    raise HTTPException(status_code=500, detail=f'git checkout failed: {stderr}')

  return {'success': True, 'branch': body.branch}


@router.post('/projects/{project_id}/git/push')
async def git_push(request: Request, project_id: str):
  """Push to remote."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  stdout, stderr, rc = await _run_git(project_dir, 'push')
  if rc != 0:
    raise HTTPException(status_code=500, detail=f'git push failed: {stderr}')

  return {'success': True, 'output': (stdout + stderr).strip()}


@router.post('/projects/{project_id}/git/pull')
async def git_pull(request: Request, project_id: str):
  """Pull from remote."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  stdout, stderr, rc = await _run_git(project_dir, 'pull')
  if rc != 0:
    raise HTTPException(status_code=500, detail=f'git pull failed: {stderr}')

  return {'success': True, 'output': (stdout + stderr).strip()}


@router.get('/projects/{project_id}/git/log')
async def git_log(
  request: Request,
  project_id: str,
  limit: int = Query(20, ge=1, le=100),
):
  """Get recent commit log."""
  project_dir = await _get_project_dir(request, project_id)
  await _ensure_git_repo(project_dir)

  stdout, stderr, rc = await _run_git(
    project_dir,
    'log',
    f'--max-count={limit}',
    '--format=%H%n%h%n%an%n%ae%n%at%n%s%n---END---',
  )
  if rc != 0:
    # No commits yet is not an error
    if 'does not have any commits' in stderr:
      return {'commits': []}
    raise HTTPException(status_code=500, detail=f'git log failed: {stderr}')

  commits = []
  entries = stdout.split('---END---')
  for entry in entries:
    lines = entry.strip().splitlines()
    if len(lines) >= 6:
      commits.append(
        {
          'hash': lines[0],
          'short_hash': lines[1],
          'author': lines[2],
          'email': lines[3],
          'timestamp': int(lines[4]),
          'message': lines[5],
        }
      )

  return {'commits': commits}


@router.post('/projects/{project_id}/sync-to-workspace')
async def sync_to_workspace(request: Request, project_id: str):
  """Sync project files to Databricks Workspace via CLI.

  Runs `databricks workspace import-dir` to upload the project to
  /Workspace/Users/{email}/projects/{project_name}/.
  """
  project_dir = await _get_project_dir(request, project_id)
  user_email = await get_current_user(request)

  # Resolve workspace host
  app_url = request.headers.get('x-forwarded-host')
  host = get_workspace_url(app_url)
  if not host:
    host = os.getenv('DATABRICKS_HOST')
  if not host:
    raise HTTPException(status_code=400, detail='Databricks workspace URL not available')

  project_name = project_dir.name
  workspace_path = f'/Workspace/Users/{user_email}/projects/{project_name}'

  proc = await asyncio.create_subprocess_exec(
    'databricks',
    'workspace',
    'import-dir',
    str(project_dir),
    workspace_path,
    '--overwrite',
    cwd=str(project_dir),
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
    env={**os.environ, 'DATABRICKS_HOST': host},
  )
  stdout_bytes, stderr_bytes = await proc.communicate()
  stdout_str = stdout_bytes.decode('utf-8', errors='replace')
  stderr_str = stderr_bytes.decode('utf-8', errors='replace')

  if proc.returncode != 0:
    raise HTTPException(
      status_code=500,
      detail=f'Workspace sync failed: {stderr_str}',
    )

  return {
    'success': True,
    'workspace_path': workspace_path,
    'output': (stdout_str + stderr_str).strip(),
  }
