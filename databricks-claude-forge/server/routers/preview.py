"""Preview server for running app development servers.

Allows users to start/stop preview servers for their projects and proxy
requests to them for local development testing.
"""

import asyncio
import logging
import subprocess
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from server.services.backup_manager import PROJECTS_BASE_DIR

logger = logging.getLogger(__name__)
router = APIRouter()

# Track running preview servers
_preview_servers: dict[str, dict] = {}  # {project_id: {'process': subprocess.Popen, 'port': int}}


def find_available_port(start_port: int = 8001) -> int:
  """Find an available port starting from start_port."""
  import socket

  port = start_port
  while port < start_port + 100:  # Try 100 ports
    if port not in [s['port'] for s in _preview_servers.values()]:
      # Quick check if port is actually available
      with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
          s.bind(('', port))
          return port
        except OSError:
          port += 1
    else:
      port += 1
  raise RuntimeError('No available ports found')


@router.post('/projects/{project_id}/preview/start')
async def start_preview_server(project_id: str):
  """Start a preview server for the project."""
  if project_id in _preview_servers:
    return {
      'status': 'already_running',
      'port': _preview_servers[project_id]['port'],
    }

  project_dir = Path(PROJECTS_BASE_DIR) / project_id
  if not project_dir.exists():
    raise HTTPException(404, 'Project not found')

  # Find available port
  try:
    port = find_available_port()
  except RuntimeError as e:
    raise HTTPException(500, str(e))

  # Start server process
  try:
    process = subprocess.Popen(
      ['uvicorn', 'app:app', '--port', str(port), '--reload'],
      cwd=project_dir,
      stdout=subprocess.PIPE,
      stderr=subprocess.STDOUT,
    )
    logger.info(f'Started preview server for project {project_id} on port {port}')
  except Exception as e:
    logger.error(f'Failed to start preview server: {e}')
    raise HTTPException(500, f'Failed to start server: {e}')

  _preview_servers[project_id] = {'process': process, 'port': port}

  return {'status': 'started', 'port': port}


@router.post('/projects/{project_id}/preview/stop')
async def stop_preview_server(project_id: str):
  """Stop the preview server."""
  if project_id not in _preview_servers:
    raise HTTPException(404, 'Preview server not running')

  server = _preview_servers[project_id]
  process = server['process']

  try:
    process.terminate()
    try:
      process.wait(timeout=5)
    except subprocess.TimeoutExpired:
      process.kill()
      process.wait()
    logger.info(f'Stopped preview server for project {project_id}')
  except Exception as e:
    logger.error(f'Error stopping preview server: {e}')
    raise HTTPException(500, f'Failed to stop server: {e}')
  finally:
    del _preview_servers[project_id]

  return {'status': 'stopped'}


@router.get('/projects/{project_id}/preview/status')
async def get_preview_status(project_id: str):
  """Get the status of the preview server."""
  if project_id not in _preview_servers:
    return {'status': 'stopped'}

  server = _preview_servers[project_id]
  process = server['process']

  # Check if process is still running
  if process.poll() is not None:
    # Process died
    del _preview_servers[project_id]
    return {'status': 'stopped', 'error': 'Process exited'}

  return {'status': 'running', 'port': server['port']}


@router.get('/projects/{project_id}/preview/{path:path}')
async def proxy_to_preview(project_id: str, path: str, request: Request):
  """Proxy requests to the preview server."""
  if project_id not in _preview_servers:
    raise HTTPException(404, 'Preview server not running')

  port = _preview_servers[project_id]['port']
  url = f'http://localhost:{port}/{path}'

  # Forward query parameters
  if request.url.query:
    url = f'{url}?{request.url.query}'

  try:
    async with httpx.AsyncClient() as client:
      response = await client.get(url, timeout=30.0)
      return Response(
        content=response.content,
        status_code=response.status_code,
        headers=dict(response.headers),
      )
  except httpx.ConnectError:
    raise HTTPException(503, 'Preview server not responding')
  except Exception as e:
    logger.error(f'Error proxying to preview server: {e}')
    raise HTTPException(500, f'Proxy error: {e}')
