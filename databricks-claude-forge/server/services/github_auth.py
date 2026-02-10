"""GitHub OAuth device flow authentication service.

Implements the GitHub Device Flow (RFC 8628) for authenticating users
without requiring a callback URL. Users visit github.com/login/device
and enter a code to authorize the application.
"""

import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

# GitHub OAuth URLs
GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
GITHUB_USER_URL = 'https://api.github.com/user'


def get_client_id() -> str:
  """Get GitHub OAuth client ID from environment."""
  client_id = os.getenv('GITHUB_OAUTH_CLIENT_ID')
  if not client_id:
    raise ValueError('GITHUB_OAUTH_CLIENT_ID environment variable not set')
  return client_id


def get_encryption_key() -> bytes:
  """Get Fernet encryption key from environment.

  If not set, generates a new key and logs a warning.
  In production, this should be set as an environment variable.
  """
  key = os.getenv('GITHUB_TOKEN_ENCRYPTION_KEY')
  if not key:
    # Generate a key for development (tokens won't survive app restarts)
    logger.warning(
      'GITHUB_TOKEN_ENCRYPTION_KEY not set. '
      'Using ephemeral key - tokens will not persist across restarts.'
    )
    return Fernet.generate_key()
  return key.encode()


# Cache the Fernet instance
_fernet: Optional[Fernet] = None


def _get_fernet() -> Fernet:
  """Get or create the Fernet encryption instance."""
  global _fernet
  if _fernet is None:
    _fernet = Fernet(get_encryption_key())
  return _fernet


def encrypt_token(token: str) -> bytes:
  """Encrypt a GitHub token for storage."""
  return _get_fernet().encrypt(token.encode())


def decrypt_token(encrypted_token: bytes) -> str:
  """Decrypt a stored GitHub token."""
  return _get_fernet().decrypt(encrypted_token).decode()


@dataclass
class DeviceFlowResponse:
  """Response from starting the device flow."""

  device_code: str
  user_code: str
  verification_uri: str
  expires_in: int
  interval: int


@dataclass
class TokenResponse:
  """Response from polling for a token."""

  access_token: Optional[str] = None
  error: Optional[str] = None
  error_description: Optional[str] = None


@dataclass
class GitHubUser:
  """GitHub user information."""

  login: str
  name: Optional[str]
  email: Optional[str]
  avatar_url: Optional[str]


async def start_device_flow() -> DeviceFlowResponse:
  """Start the GitHub device authorization flow.

  Returns the device code, user code, and verification URI.
  User should visit verification_uri and enter user_code.
  """
  client_id = get_client_id()

  async with httpx.AsyncClient() as client:
    response = await client.post(
      GITHUB_DEVICE_CODE_URL,
      data={
        'client_id': client_id,
        'scope': 'repo',  # Full repo access for push/pull
      },
      headers={'Accept': 'application/json'},
    )
    response.raise_for_status()
    data = response.json()

    return DeviceFlowResponse(
      device_code=data['device_code'],
      user_code=data['user_code'],
      verification_uri=data['verification_uri'],
      expires_in=data['expires_in'],
      interval=data['interval'],
    )


async def poll_for_token(device_code: str) -> TokenResponse:
  """Poll GitHub for the access token.

  Call this repeatedly (respecting the interval) until:
  - access_token is returned (success)
  - error is 'expired_token' or 'access_denied' (failure)

  During the flow, error may be 'authorization_pending' or 'slow_down'.
  """
  client_id = get_client_id()

  async with httpx.AsyncClient() as client:
    response = await client.post(
      GITHUB_ACCESS_TOKEN_URL,
      data={
        'client_id': client_id,
        'device_code': device_code,
        'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
      },
      headers={'Accept': 'application/json'},
    )
    response.raise_for_status()
    data = response.json()

    return TokenResponse(
      access_token=data.get('access_token'),
      error=data.get('error'),
      error_description=data.get('error_description'),
    )


async def get_github_user(token: str) -> GitHubUser:
  """Get the authenticated GitHub user's information."""
  async with httpx.AsyncClient() as client:
    response = await client.get(
      GITHUB_USER_URL,
      headers={
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    )
    response.raise_for_status()
    data = response.json()

    return GitHubUser(
      login=data['login'],
      name=data.get('name'),
      email=data.get('email'),
      avatar_url=data.get('avatar_url'),
    )


async def validate_token(token: str) -> bool:
  """Validate that a GitHub token is still valid."""
  try:
    await get_github_user(token)
    return True
  except httpx.HTTPStatusError as e:
    if e.response.status_code == 401:
      return False
    raise
