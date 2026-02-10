"""User settings storage service.

Provides per-user settings storage including GitHub token management.
"""

import logging
from typing import Optional

from server.db import UserSettings, session_scope
from server.services.github_auth import decrypt_token, encrypt_token
from sqlalchemy import select

logger = logging.getLogger(__name__)


class UserSettingsStorage:
  """User-scoped settings storage operations."""

  def __init__(self, user_email: str):
    self.user_email = user_email

  async def get(self) -> Optional[UserSettings]:
    """Get user settings."""
    async with session_scope() as session:
      result = await session.execute(
        select(UserSettings).where(UserSettings.user_email == self.user_email)
      )
      return result.scalar_one_or_none()

  async def get_or_create(self) -> UserSettings:
    """Get existing settings or create new ones."""
    async with session_scope() as session:
      result = await session.execute(
        select(UserSettings).where(UserSettings.user_email == self.user_email)
      )
      settings = result.scalar_one_or_none()
      if settings:
        return settings

      settings = UserSettings(user_email=self.user_email)
      session.add(settings)
      await session.flush()
      await session.refresh(settings)
      return settings

  async def save_github_token(self, token: str, username: str) -> None:
    """Save encrypted GitHub token and username."""
    encrypted = encrypt_token(token)
    async with session_scope() as session:
      result = await session.execute(
        select(UserSettings).where(UserSettings.user_email == self.user_email)
      )
      settings = result.scalar_one_or_none()
      if settings:
        settings.github_token_encrypted = encrypted
        settings.github_username = username
      else:
        settings = UserSettings(
          user_email=self.user_email,
          github_token_encrypted=encrypted,
          github_username=username,
        )
        session.add(settings)

  async def get_github_token(self) -> Optional[str]:
    """Get decrypted GitHub token if available."""
    async with session_scope() as session:
      result = await session.execute(
        select(UserSettings).where(UserSettings.user_email == self.user_email)
      )
      settings = result.scalar_one_or_none()
      if settings and settings.github_token_encrypted:
        try:
          return decrypt_token(settings.github_token_encrypted)
        except Exception as e:
          logger.warning(f'Failed to decrypt GitHub token for {self.user_email}: {e}')
          return None
      return None

  async def get_github_username(self) -> Optional[str]:
    """Get stored GitHub username."""
    async with session_scope() as session:
      result = await session.execute(
        select(UserSettings).where(UserSettings.user_email == self.user_email)
      )
      settings = result.scalar_one_or_none()
      return settings.github_username if settings else None

  async def clear_github_token(self) -> None:
    """Clear stored GitHub token and username."""
    async with session_scope() as session:
      result = await session.execute(
        select(UserSettings).where(UserSettings.user_email == self.user_email)
      )
      settings = result.scalar_one_or_none()
      if settings:
        settings.github_token_encrypted = None
        settings.github_username = None

  async def is_github_connected(self) -> bool:
    """Check if user has a GitHub token stored."""
    async with session_scope() as session:
      result = await session.execute(
        select(UserSettings).where(UserSettings.user_email == self.user_email)
      )
      settings = result.scalar_one_or_none()
      return bool(settings and settings.github_token_encrypted)
