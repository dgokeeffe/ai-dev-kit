"""code-server lifecycle management service.

Manages code-server (VS Code in browser) processes per project, providing:
- Process spawning with project-specific configuration
- Health checking and status monitoring
- Clean shutdown on project close
- Proxy configuration for embedding in the app
"""

import asyncio
import logging
import os
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Port range for code-server instances
CODE_SERVER_PORT_START = 8500
CODE_SERVER_PORT_END = 8599

# Track running instances
_instances: dict[str, 'CodeServerInstance'] = {}
_next_port = CODE_SERVER_PORT_START
_port_lock = asyncio.Lock()


@dataclass
class CodeServerInstance:
  """Represents a running code-server instance."""

  project_id: str
  port: int
  process: Optional[asyncio.subprocess.Process]
  started_at: datetime
  project_dir: Path
  user_data_dir: Path

  @property
  def url(self) -> str:
    """Get the local URL for this instance."""
    return f'http://127.0.0.1:{self.port}'

  @property
  def is_running(self) -> bool:
    """Check if the process is still running."""
    return self.process is not None and self.process.returncode is None


async def _get_available_port() -> int:
  """Get the next available port for a code-server instance.

  Returns:
      Available port number

  Raises:
      RuntimeError: If no ports are available
  """
  global _next_port

  async with _port_lock:
    # Find an unused port
    for _ in range(CODE_SERVER_PORT_END - CODE_SERVER_PORT_START + 1):
      port = _next_port
      _next_port = (
        CODE_SERVER_PORT_START
        if _next_port >= CODE_SERVER_PORT_END
        else _next_port + 1
      )

      # Check if port is in use by any instance
      in_use = any(
        inst.port == port and inst.is_running for inst in _instances.values()
      )
      if not in_use:
        return port

    raise RuntimeError('No available ports for code-server')


def is_code_server_available() -> bool:
  """Check if code-server is installed on the system.

  Returns:
      True if code-server executable is found
  """
  return shutil.which('code-server') is not None


async def start(project_id: str, project_dir: Path) -> CodeServerInstance:
  """Start a code-server instance for a project.

  Args:
      project_id: Unique project identifier
      project_dir: Path to the project directory to open

  Returns:
      CodeServerInstance with process and connection details

  Raises:
      RuntimeError: If code-server is not installed or fails to start
  """
  # Check if already running
  if project_id in _instances:
    instance = _instances[project_id]
    if instance.is_running:
      logger.info(f'code-server already running for project {project_id}')
      return instance
    # Clean up dead instance
    del _instances[project_id]

  # Check code-server availability
  if not is_code_server_available():
    raise RuntimeError(
      'code-server not installed. Install with: npm install -g code-server'
    )

  # Get available port
  port = await _get_available_port()

  # Create user data directory
  user_data_dir = Path(f'/tmp/code-server-{project_id}')
  user_data_dir.mkdir(parents=True, exist_ok=True)

  # Build command
  cmd = [
    'code-server',
    f'--bind-addr=127.0.0.1:{port}',
    '--auth=none',
    '--disable-telemetry',
    '--disable-update-check',
    '--app-name=Databricks Builder',
    f'--user-data-dir={user_data_dir}',
    str(project_dir),
  ]

  logger.info(f'Starting code-server for project {project_id} on port {port}')
  logger.debug(f'Command: {" ".join(cmd)}')

  try:
    # Start process
    process = await asyncio.create_subprocess_exec(
      *cmd,
      stdout=asyncio.subprocess.PIPE,
      stderr=asyncio.subprocess.PIPE,
      env={**os.environ, 'FORCE_COLOR': '0'},
    )

    instance = CodeServerInstance(
      project_id=project_id,
      port=port,
      process=process,
      started_at=datetime.utcnow(),
      project_dir=project_dir,
      user_data_dir=user_data_dir,
    )
    _instances[project_id] = instance

    # Wait briefly for startup
    await asyncio.sleep(1)

    # Check if process died immediately
    if process.returncode is not None:
      stderr = await process.stderr.read() if process.stderr else b''
      raise RuntimeError(f'code-server failed to start: {stderr.decode()}')

    logger.info(
      f'code-server started for project {project_id} at http://127.0.0.1:{port}'
    )
    return instance

  except Exception as e:
    logger.error(f'Failed to start code-server for project {project_id}: {e}')
    raise


async def stop(project_id: str) -> bool:
  """Stop a code-server instance for a project.

  Args:
      project_id: Unique project identifier

  Returns:
      True if stopped successfully, False if not running
  """
  if project_id not in _instances:
    logger.warning(f'No code-server instance found for project {project_id}')
    return False

  instance = _instances[project_id]

  if instance.process and instance.is_running:
    logger.info(f'Stopping code-server for project {project_id}')
    try:
      # Send SIGTERM for graceful shutdown
      instance.process.terminate()

      # Wait for graceful shutdown with timeout
      try:
        await asyncio.wait_for(instance.process.wait(), timeout=5.0)
      except asyncio.TimeoutError:
        # Force kill if graceful shutdown fails
        logger.warning(f'code-server {project_id} did not stop gracefully, killing')
        instance.process.kill()
        await instance.process.wait()

    except ProcessLookupError:
      # Process already dead
      pass
    except Exception as e:
      logger.error(f'Error stopping code-server for {project_id}: {e}')

  # Clean up user data directory
  try:
    if instance.user_data_dir.exists():
      shutil.rmtree(instance.user_data_dir)
  except Exception as e:
    logger.warning(f'Failed to clean up user data dir: {e}')

  del _instances[project_id]
  logger.info(f'code-server stopped for project {project_id}')
  return True


async def health(project_id: str) -> dict:
  """Check health of a code-server instance.

  Args:
      project_id: Unique project identifier

  Returns:
      Dict with status, port, url, uptime_seconds
  """
  if project_id not in _instances:
    return {
      'status': 'not_running',
      'available': is_code_server_available(),
    }

  instance = _instances[project_id]

  if not instance.is_running:
    return {
      'status': 'stopped',
      'exit_code': instance.process.returncode if instance.process else None,
    }

  uptime = (datetime.utcnow() - instance.started_at).total_seconds()

  return {
    'status': 'running',
    'port': instance.port,
    'url': instance.url,
    'uptime_seconds': round(uptime, 1),
    'project_dir': str(instance.project_dir),
  }


def get_instance(project_id: str) -> Optional[CodeServerInstance]:
  """Get the code-server instance for a project.

  Args:
      project_id: Unique project identifier

  Returns:
      CodeServerInstance or None if not running
  """
  instance = _instances.get(project_id)
  if instance and instance.is_running:
    return instance
  return None


async def stop_all() -> int:
  """Stop all running code-server instances.

  Called during application shutdown.

  Returns:
      Number of instances stopped
  """
  project_ids = list(_instances.keys())
  count = 0

  for project_id in project_ids:
    if await stop(project_id):
      count += 1

  logger.info(f'Stopped {count} code-server instance(s)')
  return count


def list_instances() -> list[dict]:
  """List all running code-server instances.

  Returns:
      List of instance info dicts
  """
  return [
    {
      'project_id': inst.project_id,
      'port': inst.port,
      'url': inst.url,
      'running': inst.is_running,
      'started_at': inst.started_at.isoformat(),
      'project_dir': str(inst.project_dir),
    }
    for inst in _instances.values()
  ]
