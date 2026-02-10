"""Configuration and user info endpoints."""

import logging
import os
from typing import Optional

from fastapi import APIRouter, Query, Request

from ..db import get_lakebase_project_id, is_postgres_configured, test_database_connection
from ..services.system_prompt import get_system_prompt
from ..services.user import get_current_user, get_workspace_url

logger = logging.getLogger(__name__)
router = APIRouter()


def _auth_debug_state(request: Request) -> dict:
  """Build auth debug state from request and env (no secrets)."""
  env = os.getenv('ENV', 'development')
  has_user = bool(request.headers.get('X-Forwarded-User'))
  has_token = bool(request.headers.get('X-Forwarded-Access-Token'))
  workspace_url = get_workspace_url()
  workspace_url_set = bool(workspace_url)
  oauth_in_env = bool(
    os.getenv('DATABRICKS_CLIENT_ID') and os.getenv('DATABRICKS_CLIENT_SECRET')
  )
  pat_in_env = bool(os.getenv('DATABRICKS_TOKEN'))
  use_pat_fallback = os.getenv('USE_PAT_FALLBACK', '').lower() in ('1', 'true', 'yes')

  hints = []
  if env == 'production':
    if not has_token and not (use_pat_fallback and pat_in_env):
      hints.append(
        'Token missing. Ensure the app proxy forwards X-Forwarded-Access-Token, '
        'or set USE_PAT_FALLBACK=1 and add DATABRICKS_TOKEN to app secrets for debugging.'
      )
    if not has_user:
      hints.append('X-Forwarded-User header missing - check app proxy configuration.')
  if not workspace_url_set:
    hints.append('Workspace URL not set. Set DATABRICKS_HOST (or DATABRICKS_WORKSPACE_URL).')

  return {
    'env': env,
    'has_forwarded_user': has_user,
    'has_forwarded_token': has_token,
    'workspace_url_set': workspace_url_set,
    'workspace_url_preview': (workspace_url or '')[:80] or '(not set)',
    'oauth_creds_in_env': oauth_in_env,
    'pat_fallback_available': use_pat_fallback and pat_in_env,
    'hints': hints,
  }


@router.get('/me')
async def get_user_info(request: Request):
  """Get current user information and app configuration."""
  user_email = await get_current_user(request)
  workspace_url = get_workspace_url()
  lakebase_configured = is_postgres_configured()
  lakebase_project_id = get_lakebase_project_id()

  # Check if database was successfully initialized at startup
  database_available = getattr(request.app.state, 'database_available', False)

  # Test database connection if configured
  lakebase_error = None
  if lakebase_configured:
    lakebase_error = await test_database_connection()

  return {
    'user': user_email,
    'workspace_url': workspace_url,
    'database_available': database_available,
    'lakebase_configured': lakebase_configured,
    'lakebase_project_id': lakebase_project_id,
    'lakebase_error': lakebase_error,
    'branding': {
      'app_title': os.environ.get('APP_TITLE', 'Vibe Coding Workshop'),
      'partner_name': os.environ.get('PARTNER_NAME', ''),
      'show_databricks_logo': True,
    },
  }


@router.get('/health')
async def health_check():
  """Health check endpoint."""
  return {'status': 'healthy'}


@router.get('/debug-auth')
async def debug_auth(request: Request):
  """Auth debug state for Databricks Apps (no secrets).

  Call from the browser or curl to see what the app sees: forwarded headers,
  workspace URL, and hints for 403 / missing token. Use when logs are hard to see.
  """
  return _auth_debug_state(request)


@router.get('/system_prompt')
async def get_system_prompt_endpoint(
  cluster_id: Optional[str] = Query(None),
  warehouse_id: Optional[str] = Query(None),
  default_catalog: Optional[str] = Query(None),
  default_schema: Optional[str] = Query(None),
  workspace_folder: Optional[str] = Query(None),
):
  """Get the system prompt with current configuration."""
  prompt = get_system_prompt(
    cluster_id=cluster_id,
    default_catalog=default_catalog,
    default_schema=default_schema,
    warehouse_id=warehouse_id,
    workspace_folder=workspace_folder,
  )
  return {'system_prompt': prompt}
