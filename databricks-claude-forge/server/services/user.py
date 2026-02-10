"""User service for getting the current authenticated user and token.

In production (Databricks Apps):
- User email is available in the X-Forwarded-User header
- Access token is available in the X-Forwarded-Access-Token header

In development, we fall back to environment variables and WorkspaceClient.
"""

import asyncio
import logging
import os
from typing import Optional

from databricks.sdk import WorkspaceClient
from fastapi import Request

logger = logging.getLogger(__name__)

# Cache for dev user to avoid repeated API calls
_dev_user_cache: Optional[str] = None
_workspace_url_cache: Optional[str] = None


def _is_local_development() -> bool:
  """Check if running in local development mode."""
  return os.getenv('ENV', 'development') == 'development'


async def get_current_user(request: Request) -> str:
  """Get the current user's email from the request.

  In production (Databricks Apps), extracts user from X-Forwarded-User header.
  In development, calls WorkspaceClient.current_user.me() and caches the result.

  Args:
      request: FastAPI Request object

  Returns:
      User's email address

  Raises:
      ValueError: If user cannot be determined
  """
  # Try to get user from header first (production mode)
  user = request.headers.get('X-Forwarded-User')
  if user:
    logger.debug(f'Got user from X-Forwarded-User header: {user}')
    return user

  # Fall back to WorkspaceClient for development
  if _is_local_development():
    return await _get_dev_user()

  # Production without header - this shouldn't happen
  raise ValueError(
    'No X-Forwarded-User header found and not in development mode. '
    'Ensure the app is deployed with user authentication enabled.'
  )


async def get_current_token(request: Request) -> str | None:
  """Get the current user's Databricks access token.

  In production (Databricks Apps), returns the X-Forwarded-Access-Token header.
  This token is needed for Claude API auth via Databricks Foundation Model API.
  In development, uses DATABRICKS_TOKEN env var.

  Args:
      request: FastAPI Request object

  Returns:
      Access token string, or None if not available
  """
  # In production (Databricks Apps), use forwarded user token
  # This is needed for Claude API auth via Foundation Model API
  if not _is_local_development():
    token = request.headers.get('X-Forwarded-Access-Token')
    if token:
      logger.debug('Production mode: got token from X-Forwarded-Access-Token header')
      return token
    # Optional: use PAT from app secrets for debugging when proxy does not forward token
    if os.getenv('USE_PAT_FALLBACK', '').lower() in ('1', 'true', 'yes'):
      pat = os.getenv('DATABRICKS_TOKEN')
      if pat:
        logger.warning(
          'Production: using PAT fallback (USE_PAT_FALLBACK=1). '
          'Add DATABRICKS_TOKEN to app secrets. For debugging only.'
        )
        return pat
    logger.warning('Production mode: no X-Forwarded-Access-Token header found')
    return None

  # Fall back to env var for development
  token = os.getenv('DATABRICKS_TOKEN')
  if token:
    logger.debug('Got token from DATABRICKS_TOKEN env var')
    return token

  return None


async def _get_dev_user() -> str:
  """Get user email from WorkspaceClient in development mode."""
  global _dev_user_cache

  if _dev_user_cache is not None:
    logger.debug(f'Using cached dev user: {_dev_user_cache}')
    return _dev_user_cache

  logger.info('Fetching current user from WorkspaceClient')

  # Run the synchronous SDK call in a thread pool to avoid blocking
  user_email = await asyncio.to_thread(_fetch_user_from_workspace)

  _dev_user_cache = user_email
  logger.info(f'Cached dev user: {user_email}')

  return user_email


def _fetch_user_from_workspace() -> str:
  """Synchronous helper to fetch user from WorkspaceClient."""
  # Check if Databricks credentials are configured
  host = os.getenv('DATABRICKS_HOST', '')
  token = os.getenv('DATABRICKS_TOKEN', '')

  placeholder_host = 'https://your-workspace.cloud.databricks.com'
  if not host or host == placeholder_host or not token or token == 'dapi...':
    logger.warning('Databricks credentials not configured, using default dev user')
    return 'dev-user@local'

  try:
    # WorkspaceClient will use DATABRICKS_HOST and DATABRICKS_TOKEN from env
    client = WorkspaceClient()
    me = client.current_user.me()

    if not me.user_name:
      raise ValueError('WorkspaceClient returned user without email/user_name')

    return me.user_name

  except Exception as e:
    logger.error(f'Failed to get current user from WorkspaceClient: {e}')
    if _is_local_development():
      logger.warning('Using default dev user due to Databricks connection failure')
      return 'dev-user@local'
    raise


def _derive_workspace_url_from_app_url(app_url: str) -> str | None:
  """Derive workspace URL from Databricks App URL.

  App URL pattern: <app-name>-<workspace-id>.<region>.azure.databricksapps.com
  Workspace URL pattern: adb-<workspace-id>.<region>.azuredatabricks.net

  Args:
      app_url: The Databricks App URL

  Returns:
      Derived workspace URL, or None if cannot be derived
  """
  import re

  # Pattern: something-<workspace_id>.<region>.azure.databricksapps.com
  # or: something-<workspace_id>.<region>.databricksapps.com (AWS/GCP)
  match = re.search(r'-(\d+)\.(\d+)\.(azure\.)?databricksapps\.com', app_url)
  if match:
    workspace_id = match.group(1)
    region = match.group(2)
    is_azure = match.group(3) is not None
    if is_azure:
      return f'https://adb-{workspace_id}.{region}.azuredatabricks.net'
    else:
      # AWS/GCP pattern - might need adjustment
      return f'https://adb-{workspace_id}.{region}.databricks.com'
  return None


def get_workspace_url(app_url: str | None = None) -> str:
  """Get the Databricks workspace URL.

  Tries multiple sources in order:
  1. DATABRICKS_HOST env var (set automatically by Databricks Apps platform)
  2. DATABRICKS_WORKSPACE_URL env var (explicit override)
  3. WorkspaceClient config
  4. Derive from app URL (fragile, last resort)

  Args:
      app_url: Optional app URL to derive workspace URL from

  Returns:
      Workspace URL (e.g., https://adb-123456789.11.azuredatabricks.net)
  """
  global _workspace_url_cache

  if _workspace_url_cache is not None:
    return _workspace_url_cache

  # Try DATABRICKS_HOST first (set automatically by Databricks Apps platform)
  host = os.getenv('DATABRICKS_HOST')
  if host:
    _workspace_url_cache = host.rstrip('/')
    logger.debug(f'Got workspace URL from DATABRICKS_HOST: {_workspace_url_cache}')
    return _workspace_url_cache

  # Try DATABRICKS_WORKSPACE_URL (explicit override)
  host = os.getenv('DATABRICKS_WORKSPACE_URL')
  if host:
    _workspace_url_cache = host.rstrip('/')
    logger.debug(f'Got workspace URL from DATABRICKS_WORKSPACE_URL: {_workspace_url_cache}')
    return _workspace_url_cache

  # Fall back to WorkspaceClient config (just reads from config, not a network call)
  try:
    client = WorkspaceClient()
    if client.config.host:
      _workspace_url_cache = client.config.host.rstrip('/')
      logger.debug(f'Got workspace URL from WorkspaceClient: {_workspace_url_cache}')
      return _workspace_url_cache
  except Exception as e:
    logger.warning(f'Failed to get workspace URL from WorkspaceClient: {e}')

  # Last resort: derive from app URL (fragile, may not work on all clouds)
  if app_url:
    derived = _derive_workspace_url_from_app_url(app_url)
    if derived:
      _workspace_url_cache = derived
      logger.debug(f'Derived workspace URL from app URL: {_workspace_url_cache}')
      return _workspace_url_cache

  logger.error('Could not determine workspace URL from any source')
  return ''


async def get_user_credentials(request: Request) -> tuple[str | None, str | None]:
  """Get the Databricks host and token for API calls.

  In production (Databricks Apps), uses forwarded headers.
  In development, uses environment variables.

  Args:
      request: FastAPI Request object

  Returns:
      Tuple of (host, token) - either may be None if not available
  """
  # Try to get from headers first (production mode)
  host = request.headers.get('X-Forwarded-Host')
  token = request.headers.get('X-Forwarded-Access-Token')

  if host and token:
    logger.debug('Got credentials from forwarded headers')
    return host, token

  # Fall back to env vars for development
  host = os.getenv('DATABRICKS_HOST')
  token = os.getenv('DATABRICKS_TOKEN')

  if host and token:
    logger.debug('Got credentials from environment variables')
    return host, token

  # Try WorkspaceClient config
  try:
    client = WorkspaceClient()
    host = client.config.host
    token = client.config.token
    if host and token:
      logger.debug('Got credentials from WorkspaceClient config')
      return host, token
  except Exception as e:
    logger.warning(f'Failed to get credentials from WorkspaceClient: {e}')

  return None, None
