"""Terminal execution endpoint for the IDE.

Provides a simple command execution interface for the project directory.
Commands are run in a subprocess with timeout and output capture.
"""

import asyncio
import logging
import os
import shlex

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..services.backup_manager import ensure_project_directory
from ..services.storage import ProjectStorage
from ..services.user import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

# Maximum command execution time in seconds
MAX_EXECUTION_TIME = 30

# Commands that are allowed (whitelist approach for security)
ALLOWED_COMMANDS = {
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'sort', 'uniq',
  'echo', 'pwd', 'date', 'whoami', 'env', 'printenv',
  'python', 'python3', 'pip', 'pip3',
  'node', 'npm', 'npx',
  'git',
  'curl', 'wget',
  'mkdir', 'touch', 'cp', 'mv', 'rm',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'which', 'type', 'file',
  'diff', 'patch',
  'ruff', 'black', 'mypy', 'pylint', 'pytest',
  'eslint', 'prettier', 'tsc',
}

# Commands that are explicitly blocked
BLOCKED_COMMANDS = {
  'sudo', 'su', 'chown', 'chmod', 'chroot',
  'rm -rf /', 'dd', 'mkfs', 'fdisk',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'kill', 'killall', 'pkill',
  '>>', '>', '|', '&&', '||', ';',  # These are handled by shell=False
}


class ExecuteRequest(BaseModel):
  """Request model for command execution."""
  command: str


class ExecuteResponse(BaseModel):
  """Response model for command execution."""
  stdout: str
  stderr: str
  exit_code: int


async def _verify_project_access(request: Request, project_id: str) -> str:
  """Verify the user has access to the project and return the project directory path.

  Args:
      request: FastAPI request object
      project_id: Project UUID

  Returns:
      Path to the project directory as string

  Raises:
      HTTPException: If project not found or access denied
  """
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  project = await storage.get(project_id)
  if not project:
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  project_dir = ensure_project_directory(project_id)
  return str(project_dir)


def _parse_command(command: str) -> tuple[str, list[str]]:
  """Parse a command string into executable and arguments.

  Args:
      command: The command string to parse

  Returns:
      Tuple of (executable, arguments list)

  Raises:
      ValueError: If command is invalid
  """
  try:
    parts = shlex.split(command)
    if not parts:
      raise ValueError('Empty command')
    return parts[0], parts[1:]
  except ValueError as e:
    raise ValueError(f'Invalid command syntax: {e}')


def _is_command_allowed(executable: str) -> bool:
  """Check if the command executable is allowed.

  Args:
      executable: The command name

  Returns:
      True if allowed, False otherwise
  """
  # Get the base command name (handle paths like /usr/bin/python)
  base_cmd = os.path.basename(executable)

  # Check against allowed commands
  return base_cmd in ALLOWED_COMMANDS


@router.post('/projects/{project_id}/terminal/execute')
async def execute_command(
  request: Request,
  project_id: str,
  body: ExecuteRequest
) -> ExecuteResponse:
  """Execute a command in the project directory.

  The command is run in a subprocess with:
  - Working directory set to the project directory
  - Timeout of 30 seconds
  - Shell disabled for security (commands are parsed and executed directly)
  - Only whitelisted commands are allowed

  Args:
      request: FastAPI request
      project_id: Project UUID
      body: Command to execute

  Returns:
      Command output (stdout, stderr, exit_code)
  """
  project_dir = await _verify_project_access(request, project_id)

  command = body.command.strip()
  if not command:
    raise HTTPException(status_code=400, detail='Empty command')

  # Parse the command
  try:
    executable, args = _parse_command(command)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))

  # Security check - only allow whitelisted commands
  if not _is_command_allowed(executable):
    raise HTTPException(
      status_code=403,
      detail=(
    f'Command "{executable}" is not allowed. '
    f'Allowed commands: {", ".join(sorted(ALLOWED_COMMANDS))}'
  )
    )

  logger.info(f'Executing command in project {project_id}: {command}')

  try:
    # Run the command in the project directory
    process = await asyncio.create_subprocess_exec(
      executable,
      *args,
      stdout=asyncio.subprocess.PIPE,
      stderr=asyncio.subprocess.PIPE,
      cwd=project_dir,
      env={
        **os.environ,
        'HOME': os.environ.get('HOME', '/tmp'),
        'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
      }
    )

    try:
      stdout, stderr = await asyncio.wait_for(
        process.communicate(),
        timeout=MAX_EXECUTION_TIME
      )
    except asyncio.TimeoutError:
      process.kill()
      await process.wait()
      raise HTTPException(
        status_code=408,
        detail=f'Command timed out after {MAX_EXECUTION_TIME} seconds'
      )

    return ExecuteResponse(
      stdout=stdout.decode('utf-8', errors='replace'),
      stderr=stderr.decode('utf-8', errors='replace'),
      exit_code=process.returncode or 0
    )

  except FileNotFoundError:
    raise HTTPException(
      status_code=404,
      detail=f'Command "{executable}" not found'
    )
  except PermissionError:
    raise HTTPException(
      status_code=403,
      detail=f'Permission denied executing "{executable}"'
    )
  except Exception as e:
    logger.error(f'Error executing command: {e}')
    raise HTTPException(
      status_code=500,
      detail=f'Command execution failed: {e}'
    )
