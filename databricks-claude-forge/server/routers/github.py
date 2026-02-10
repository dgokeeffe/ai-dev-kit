"""GitHub OAuth device flow endpoints.

Implements the GitHub Device Flow for authenticating users without
requiring a callback URL. Users visit github.com/login/device and
enter a code to authorize the application.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..services.github_auth import (
  get_github_user,
  poll_for_token,
  start_device_flow,
  validate_token,
)
from ..services.user import get_current_user
from ..services.user_settings import UserSettingsStorage

logger = logging.getLogger(__name__)
router = APIRouter()


class DeviceFlowStartResponse(BaseModel):
  """Response from starting the device flow."""

  device_code: str
  user_code: str
  verification_uri: str
  expires_in: int
  interval: int


class DeviceFlowPollRequest(BaseModel):
  """Request to poll for token completion."""

  device_code: str


class DeviceFlowPollResponse(BaseModel):
  """Response from polling for token."""

  status: str  # 'pending', 'success', 'error'
  username: str | None = None
  error: str | None = None


class GitHubStatusResponse(BaseModel):
  """GitHub connection status."""

  connected: bool
  username: str | None = None


def _check_github_configured() -> None:
  """Check if GitHub OAuth is configured."""
  if not os.getenv('GITHUB_OAUTH_CLIENT_ID'):
    raise HTTPException(
      status_code=503,
      detail='GitHub integration not configured. Set GITHUB_OAUTH_CLIENT_ID.',
    )


@router.post('/github/device-flow/start', response_model=DeviceFlowStartResponse)
async def github_device_flow_start(request: Request):
  """Start the GitHub device authorization flow.

  Returns a user_code and verification_uri. The user should visit
  verification_uri (github.com/login/device) and enter the user_code.
  """
  _check_github_configured()
  await get_current_user(request)  # Verify auth

  try:
    result = await start_device_flow()
    return DeviceFlowStartResponse(
      device_code=result.device_code,
      user_code=result.user_code,
      verification_uri=result.verification_uri,
      expires_in=result.expires_in,
      interval=result.interval,
    )
  except Exception as e:
    logger.exception('Failed to start GitHub device flow')
    raise HTTPException(status_code=500, detail=f'Failed to start device flow: {e}')


@router.post('/github/device-flow/poll', response_model=DeviceFlowPollResponse)
async def github_device_flow_poll(request: Request, body: DeviceFlowPollRequest):
  """Poll for the GitHub access token.

  Call this repeatedly (respecting the interval from start) until
  status is 'success' or 'error'. Status 'pending' means the user
  hasn't completed authorization yet.
  """
  _check_github_configured()
  user_email = await get_current_user(request)

  try:
    result = await poll_for_token(body.device_code)

    if result.access_token:
      # Get GitHub user info
      github_user = await get_github_user(result.access_token)

      # Save token
      storage = UserSettingsStorage(user_email)
      await storage.save_github_token(result.access_token, github_user.login)

      logger.info(f'GitHub connected for {user_email} as {github_user.login}')
      return DeviceFlowPollResponse(status='success', username=github_user.login)

    if result.error == 'authorization_pending':
      return DeviceFlowPollResponse(status='pending')

    if result.error == 'slow_down':
      return DeviceFlowPollResponse(status='pending')

    # Terminal errors
    return DeviceFlowPollResponse(
      status='error',
      error=result.error_description or result.error or 'Unknown error',
    )

  except Exception as e:
    logger.exception('Failed to poll GitHub device flow')
    raise HTTPException(status_code=500, detail=f'Failed to poll: {e}')


@router.get('/github/status', response_model=GitHubStatusResponse)
async def github_status(request: Request):
  """Get GitHub connection status for the current user."""
  user_email = await get_current_user(request)
  storage = UserSettingsStorage(user_email)

  # Check if we have a token
  token = await storage.get_github_token()
  if not token:
    return GitHubStatusResponse(connected=False)

  # Validate the token is still valid
  if await validate_token(token):
    username = await storage.get_github_username()
    return GitHubStatusResponse(connected=True, username=username)

  # Token is invalid, clear it
  await storage.clear_github_token()
  return GitHubStatusResponse(connected=False)


@router.post('/github/disconnect')
async def github_disconnect(request: Request):
  """Disconnect GitHub - clear stored token."""
  user_email = await get_current_user(request)
  storage = UserSettingsStorage(user_email)
  await storage.clear_github_token()
  logger.info(f'GitHub disconnected for {user_email}')
  return {'success': True}
