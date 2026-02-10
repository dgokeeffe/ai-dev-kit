"""Health check endpoint for monitoring and load balancer probes."""

import os

from fastapi import APIRouter

from .pty import _sessions

router = APIRouter()


@router.get('/health')
async def health_check():
  """Return health status and instance information.

  Used by load balancers and monitoring systems to verify the backend is
  operational. Also exposes instance identifier and PTY session count for
  debugging multi-instance deployments.
  """
  return {
    'status': 'healthy',
    'app_instance': os.getenv('APP_INSTANCE', 'unknown'),
    'active_pty_sessions': len(_sessions),
  }
