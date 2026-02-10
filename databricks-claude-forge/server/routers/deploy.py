"""Deploy management endpoints for Databricks Apps deployment.

Handles deploying projects to Databricks Apps using the Databricks CLI
(databricks bundle deploy).
"""

import asyncio
import json
import logging
import os
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from ..db import get_session
from ..db.models import DeploymentHistory
from ..services.backup_manager import ensure_project_directory
from ..services.storage import ProjectStorage
from ..services.user import get_current_user, get_user_credentials

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory deploy status tracking (per project)
_deploy_status: dict[str, dict] = {}

# Locks to prevent race conditions during concurrent deployments
_deploy_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


class DeployConfig(BaseModel):
  """Configuration for deployment."""

  target: str = 'dev'  # DAB target (dev, staging, prod)
  app_name: Optional[str] = None  # Auto-generated if not provided
  variables: Optional[dict[str, str]] = None  # Bundle variables


async def _verify_project_access(request: Request, project_id: str) -> Path:
  """Verify the user has access to the project and return the project directory.

  Args:
      request: FastAPI request object
      project_id: Project UUID

  Returns:
      Path to the project directory

  Raises:
      HTTPException: If project not found or access denied
  """
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  project = await storage.get(project_id)
  if not project:
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  return ensure_project_directory(project_id)


def _get_deploy_status(project_id: str) -> dict:
  """Get the current deploy status for a project."""
  return _deploy_status.get(project_id, {
    'status': 'idle',
    'app_url': None,
    'error': None,
    'started_at': None,
    'completed_at': None,
    'logs': [],
  })


async def _set_deploy_status(project_id: str, **kwargs):
  """Update deploy status for a project.

  Thread-safe with asyncio.Lock to prevent race conditions during concurrent deployments.
  """
  async with _deploy_locks[project_id]:
    if project_id not in _deploy_status:
      _deploy_status[project_id] = {
        'status': 'idle',
        'app_url': None,
        'error': None,
        'started_at': None,
        'completed_at': None,
        'logs': [],
      }
    _deploy_status[project_id].update(kwargs)


async def _add_deploy_log(project_id: str, level: str, message: str):
  """Add a log entry for a deployment.

  Thread-safe with asyncio.Lock to prevent race conditions during concurrent deployments.
  """
  async with _deploy_locks[project_id]:
    if project_id not in _deploy_status:
      _deploy_status[project_id] = {
        'status': 'idle',
        'app_url': None,
        'error': None,
        'started_at': None,
        'completed_at': None,
        'logs': [],
      }

    log_entry = {
      'timestamp': datetime.utcnow().isoformat(),
      'level': level,
      'message': message,
    }
    _deploy_status[project_id]['logs'].append(log_entry)

    # Keep only last 500 log entries
    if len(_deploy_status[project_id]['logs']) > 500:
      _deploy_status[project_id]['logs'] = _deploy_status[project_id]['logs'][-500:]


def _find_app_yaml(project_dir: Path) -> Optional[Path]:
  """Find app.yaml or databricks.yml in the project directory.

  Searches for Databricks App configuration files.

  Args:
      project_dir: Project directory to search

  Returns:
      Path to the config file, or None if not found
  """
  # Check for app.yaml (Databricks Apps)
  app_yaml = project_dir / 'app.yaml'
  if app_yaml.exists():
    return app_yaml

  # Check for databricks.yml (Databricks Asset Bundles)
  databricks_yml = project_dir / 'databricks.yml'
  if databricks_yml.exists():
    return databricks_yml

  return None


def detect_deploy_command(
  project_dir: Path,
  app_name: str = 'my-app',
  target: str = 'dev',
) -> Optional[dict]:
  """Detect which deploy command to use based on project config files.

  Args:
      project_dir: Project directory to analyze
      app_name: App name for `databricks apps deploy` command
      target: Target for `databricks bundle deploy` command

  Returns:
      dict with 'type' ('apps' or 'bundle'), 'command' (list of args), and 'config_file'
      Returns None if no config file found
  """
  app_yaml = project_dir / 'app.yaml'
  databricks_yml = project_dir / 'databricks.yml'

  # Prefer app.yaml for simple Databricks Apps
  if app_yaml.exists():
    return {
      'type': 'apps',
      'command': [
        'databricks',
        'apps',
        'deploy',
        app_name,
        '--source-code-path',
        str(project_dir),
      ],
      'config_file': str(app_yaml),
    }

  # Fall back to databricks.yml for Asset Bundles
  if databricks_yml.exists():
    return {
      'type': 'bundle',
      'command': ['databricks', 'bundle', 'deploy', '--target', target],
      'config_file': str(databricks_yml),
    }

  return None


def _generate_app_name(project_name: str, target: str) -> str:
  """Generate app name from project name and target.

  Example: "My Project" + "dev" -> "my-project-dev"

  Args:
      project_name: Project name
      target: Deployment target (dev/staging/prod)

  Returns:
      Generated app name (lowercase, hyphenated)
  """
  import re

  name = project_name.lower().replace(' ', '-').replace('_', '-')
  name = re.sub(r'[^a-z0-9-]', '', name)
  name = re.sub(r'-+', '-', name).strip('-')
  max_len = 50 - len(target) - 1
  if len(name) > max_len:
    name = name[:max_len].rstrip('-')
  return f'{name}-{target}'


async def _get_app_url_from_api(app_name: str, host: str, token: str) -> Optional[str]:
  """Get app URL from Databricks API instead of regex parsing.

  Uses WorkspaceClient.apps.get() after deployment.

  Args:
      app_name: Name of the deployed app
      host: Databricks workspace URL
      token: Databricks access token

  Returns:
      App URL if found, None otherwise
  """
  try:
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.core import Config

    config = Config(host=host, token=token)
    client = WorkspaceClient(config=config)
    app = await asyncio.to_thread(client.apps.get, name=app_name)

    if app and app.url:
      logger.info(f'Got app URL from API: {app.url}')
      return app.url
    return None
  except Exception as e:
    logger.warning(f'Failed to get app URL from API: {e}')
    return None


async def _validate_deployment(project_dir: Path, host: str, token: str) -> dict:
  """Run pre-flight checks before deployment.

  Args:
      project_dir: Project directory
      host: Databricks workspace URL
      token: Databricks access token

  Returns:
      dict with 'ready': bool, 'checks': list, 'warnings': list
  """
  import shutil

  checks = []
  warnings = []

  # Check 1: Config file
  config_file = _find_app_yaml(project_dir)
  checks.append({
    'name': 'Configuration file',
    'passed': config_file is not None,
    'message': f'Found {config_file.name}' if config_file else 'Missing app.yaml/databricks.yml',
  })

  # Check 2: Databricks CLI
  cli_available = shutil.which('databricks') is not None
  checks.append({
    'name': 'Databricks CLI',
    'passed': cli_available,
    'message': 'CLI installed' if cli_available else 'Install: pip install databricks-cli',
  })

  # Check 3: Credentials
  checks.append({
    'name': 'Databricks credentials',
    'passed': bool(host and token),
    'message': 'Available' if (host and token) else 'Not found',
  })

  # Check 4: Frontend build (if hybrid app)
  if (project_dir / 'client').exists():
    client_out = project_dir / 'client/out'
    has_build = client_out.exists() and (client_out / 'index.html').exists()
    if not has_build:
      warnings.append('Frontend not built - Databricks Apps will build automatically')

  ready = all(c['passed'] for c in checks)
  return {'ready': ready, 'checks': checks, 'warnings': warnings}


async def _run_deploy_command(
  project_id: str,
  project_dir: Path,
  host: str,
  token: str,
  app_name: str = 'my-app',
  target: str = 'dev',
  variables: Optional[dict[str, str]] = None,
) -> AsyncIterator[dict]:
  """Run deploy command and stream output.

  Detects whether to use `databricks apps deploy` or `databricks bundle deploy`
  based on the config files present in the project directory.

  Args:
      project_id: Project UUID for status tracking
      project_dir: Project directory
      host: Databricks workspace URL
      token: Databricks access token
      app_name: App name for `databricks apps deploy`
      target: DAB target for `databricks bundle deploy`
      variables: Optional bundle variables (only for bundle deploy)

  Yields:
      Log entries as dicts
  """
  # Detect deploy command type
  deploy_config = detect_deploy_command(project_dir, app_name, target)

  if deploy_config is None:
    error_msg = 'No app.yaml or databricks.yml found in project'
    await _add_deploy_log(project_id, 'error', error_msg)
    yield {'timestamp': datetime.utcnow().isoformat(), 'level': 'error', 'message': error_msg}
    raise Exception(error_msg)

  cmd = deploy_config['command']

  # Add variables only for bundle deploy
  if deploy_config['type'] == 'bundle' and variables:
    for key, value in variables.items():
      cmd.extend(['--var', f'{key}={value}'])

  # Set up environment with Databricks auth
  env = os.environ.copy()
  env['DATABRICKS_HOST'] = host
  env['DATABRICKS_TOKEN'] = token

  logger.info(f'Running deploy command: {" ".join(cmd)}')
  await _add_deploy_log(project_id, 'info', f'Running: {" ".join(cmd)}')

  try:
    process = await asyncio.create_subprocess_exec(
      *cmd,
      stdout=asyncio.subprocess.PIPE,
      stderr=asyncio.subprocess.STDOUT,
      cwd=str(project_dir),
      env=env,
    )

    # Stream output line by line
    while True:
      line = await process.stdout.readline()
      if not line:
        break

      text = line.decode('utf-8').rstrip()
      if text:
        level = 'error' if 'error' in text.lower() else 'info'
        await _add_deploy_log(project_id, level, text)
        yield {'timestamp': datetime.utcnow().isoformat(), 'level': level, 'message': text}

    # Wait for process to complete
    await process.wait()

    if process.returncode == 0:
      await _add_deploy_log(project_id, 'info', 'Deployment completed successfully')
      yield {
        'timestamp': datetime.utcnow().isoformat(),
        'level': 'info',
        'message': 'Deployment completed successfully',
      }
    else:
      error_msg = f'Deployment failed with exit code {process.returncode}'
      await _add_deploy_log(project_id, 'error', error_msg)
      yield {'timestamp': datetime.utcnow().isoformat(), 'level': 'error', 'message': error_msg}
      raise Exception(error_msg)

  except FileNotFoundError:
    error_msg = 'Databricks CLI not found. Please install it: pip install databricks-cli'
    await _add_deploy_log(project_id, 'error', error_msg)
    yield {'timestamp': datetime.utcnow().isoformat(), 'level': 'error', 'message': error_msg}
    raise Exception(error_msg)


@router.post('/projects/{project_id}/deploy/validate')
async def validate_deployment(request: Request, project_id: str):
  """Run pre-flight validation without deploying.

  Args:
      request: FastAPI request object
      project_id: Project UUID

  Returns:
      Validation result with checks and warnings
  """
  project_dir = await _verify_project_access(request, project_id)
  host, token = await get_user_credentials(request)
  return await _validate_deployment(project_dir, host, token)


@router.get('/projects/{project_id}/deploy/history')
async def get_deployment_history(request: Request, project_id: str):
  """Get deployment history for a project.

  Args:
      request: FastAPI request object
      project_id: Project UUID

  Returns:
      List of deployment records
  """
  await _verify_project_access(request, project_id)

  from sqlalchemy import select

  async with get_session() as session:
    result = await session.execute(
      select(DeploymentHistory)
      .where(DeploymentHistory.project_id == project_id)
      .order_by(DeploymentHistory.started_at.desc())
      .limit(50)
    )
    return [d.to_dict() for d in result.scalars().all()]


@router.post('/projects/{project_id}/deploy')
async def deploy_project(request: Request, project_id: str, config: DeployConfig = None):
  """Deploy a project to Databricks Apps.

  Automatically selects the appropriate deploy command based on config files:
  - app.yaml -> `databricks apps deploy <app-name> --source-code-path <dir>`
  - databricks.yml -> `databricks bundle deploy --target <target>`

  Args:
      request: FastAPI request object
      project_id: Project UUID
      config: Optional deployment configuration
  """
  if config is None:
    config = DeployConfig()

  project_dir = await _verify_project_access(request, project_id)

  # Check for deployment config file
  config_file = _find_app_yaml(project_dir)
  if not config_file:
    raise HTTPException(
      status_code=400,
      detail=(
        'No app.yaml or databricks.yml found. '
        'Please create a Databricks App or Asset Bundle configuration.'
      ),
    )

  # Check if already deploying
  status = _get_deploy_status(project_id)
  if status['status'] == 'deploying':
    raise HTTPException(status_code=409, detail='Deployment already in progress')

  # Get user credentials
  host, token = await get_user_credentials(request)
  if not host or not token:
    raise HTTPException(status_code=401, detail='Databricks credentials not available')

  # Get project name for auto-generating app name
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)
  project = await storage.get(project_id)

  # Auto-generate app name if not provided
  app_name = config.app_name
  if not app_name:
    app_name = _generate_app_name(project.name, config.target)
    logger.info(f'Auto-generated app name: {app_name}')

  # Create deployment history record

  deployment_id = None
  async with get_session() as session:
    deployment = DeploymentHistory(
      project_id=project_id,
      target=config.target,
      app_name=app_name,
      status='deploying',
    )
    session.add(deployment)
    await session.commit()
    deployment_id = deployment.id
    logger.info(f'Created deployment record: {deployment_id}')

  # Update status
  await _set_deploy_status(
    project_id,
    status='deploying',
    error=None,
    started_at=datetime.utcnow().isoformat(),
    completed_at=None,
    logs=[],
  )

  async def run_deploy():
    """Background task to run deployment."""
    logs_collected = []
    try:
      app_url = None
      async for log in _run_deploy_command(
        project_id=project_id,
        project_dir=project_dir,
        host=host,
        token=token,
        app_name=app_name,
        target=config.target,
        variables=config.variables,
      ):
        logs_collected.append(log)
        # Try to extract app URL from logs as fallback
        msg = log.get('message', '')
        if 'https://' in msg and '.apps.' in msg:
          import re

          url_match = re.search(r'https://[^\s]+\.apps\.[^\s]+', msg)
          if url_match:
            app_url = url_match.group(0)

      # Try to get app URL from API (preferred method)
      api_url = await _get_app_url_from_api(app_name, host, token)
      if api_url:
        app_url = api_url

      # Update in-memory status
      await _set_deploy_status(
        project_id,
        status='success',
        app_url=app_url,
        completed_at=datetime.utcnow().isoformat(),
      )

      # Update database record
      async with get_session() as session:
        result = await session.execute(
          select(DeploymentHistory).where(DeploymentHistory.id == deployment_id)
        )
        deployment = result.scalar_one_or_none()
        if deployment:
          deployment.status = 'success'
          deployment.app_url = app_url
          deployment.logs_json = json.dumps(logs_collected)
          deployment.completed_at = datetime.utcnow()
          await session.commit()

    except Exception as e:
      logger.error(f'Deployment failed for project {project_id}: {e}')

      # Update in-memory status
      await _set_deploy_status(
        project_id,
        status='error',
        error=str(e),
        completed_at=datetime.utcnow().isoformat(),
      )

      # Update database record
      async with get_session() as session:
        result = await session.execute(
          select(DeploymentHistory).where(DeploymentHistory.id == deployment_id)
        )
        deployment = result.scalar_one_or_none()
        if deployment:
          deployment.status = 'error'
          deployment.error_message = str(e)
          deployment.logs_json = json.dumps(logs_collected)
          deployment.completed_at = datetime.utcnow()
          await session.commit()

  # Start deployment in background
  asyncio.create_task(run_deploy())

  return {
    'status': 'deploying',
    'message': f'Deployment started for target: {config.target}',
    'config_file': str(config_file.name),
  }


@router.get('/projects/{project_id}/deploy/status')
async def get_deploy_status(request: Request, project_id: str):
  """Get the current deployment status for a project.

  Returns the status, any error message, deployed app URL, and recent logs.
  """
  await _verify_project_access(request, project_id)

  status = _get_deploy_status(project_id)

  return {
    'status': status['status'],
    'app_url': status['app_url'],
    'error': status['error'],
    'started_at': status['started_at'],
    'completed_at': status['completed_at'],
  }


@router.get('/projects/{project_id}/deploy/logs')
async def stream_deploy_logs(request: Request, project_id: str):
  """Stream deployment logs as Server-Sent Events.

  Returns existing logs immediately, then streams new logs as they arrive.
  """
  await _verify_project_access(request, project_id)

  async def generate():
    # First, send all existing logs
    status = _get_deploy_status(project_id)
    sent_count = 0

    for log in status.get('logs', []):
      yield f'data: {json.dumps(log)}\n\n'
      sent_count += 1

    # If deployment is still in progress, poll for new logs
    while status.get('status') == 'deploying':
      await asyncio.sleep(0.5)
      status = _get_deploy_status(project_id)
      logs = status.get('logs', [])

      # Send new logs
      for log in logs[sent_count:]:
        yield f'data: {json.dumps(log)}\n\n'
        sent_count += 1

    # Send final status
    final_data = {
      'type': 'status',
      'status': status.get('status'),
      'app_url': status.get('app_url'),
    }
    yield f'data: {json.dumps(final_data)}\n\n'

  return StreamingResponse(
    generate(),
    media_type='text/event-stream',
    headers={
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  )


@router.post('/projects/{project_id}/deploy/cancel')
async def cancel_deploy(request: Request, project_id: str):
  """Cancel an in-progress deployment.

  Note: This only updates the status - it cannot actually cancel a running
  databricks bundle deploy command. The command will continue in the background.
  """
  await _verify_project_access(request, project_id)

  status = _get_deploy_status(project_id)
  if status['status'] != 'deploying':
    raise HTTPException(
      status_code=400,
      detail='No deployment in progress to cancel'
    )

  # Update status to cancelled
  await _set_deploy_status(
    project_id,
    status='cancelled',
    error='Deployment cancelled by user',
    completed_at=datetime.utcnow().isoformat(),
  )
  await _add_deploy_log(project_id, 'warning', 'Deployment cancelled by user')

  return {'status': 'cancelled', 'message': 'Deployment marked as cancelled'}
