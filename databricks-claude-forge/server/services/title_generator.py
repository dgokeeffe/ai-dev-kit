"""AI-powered conversation title generation.

Uses Claude to generate concise, descriptive titles for conversations
based on the first user message.
"""

import asyncio
import logging
import os

import anthropic

logger = logging.getLogger(__name__)

# Cache the Anthropic client for dev mode (no per-user auth needed)
_dev_client = None

# Default model for FMAPI (Databricks Foundation Model API)
_FMAPI_MODEL = 'databricks-claude-sonnet-4-5'
# Default model for direct Anthropic API
_DIRECT_MODEL = 'claude-3-5-haiku-latest'


def _get_dev_client() -> anthropic.AsyncAnthropic:
  """Get or create the cached Anthropic client for dev mode."""
  global _dev_client
  if _dev_client is None:
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    base_url = os.environ.get('ANTHROPIC_BASE_URL')

    if base_url:
      _dev_client = anthropic.AsyncAnthropic(
        api_key=api_key or 'unused',
        base_url=base_url,
      )
    else:
      _dev_client = anthropic.AsyncAnthropic(api_key=api_key)

  return _dev_client


def _get_client(
  auth_token: str | None = None,
) -> tuple[anthropic.AsyncAnthropic, str]:
  """Get an Anthropic client and model name for title generation.

  Args:
      auth_token: User's Databricks token for FMAPI auth.
          If provided, creates a per-request client with this token.
          If None, uses the cached dev client.

  Returns:
      Tuple of (client, model_name)
  """
  base_url = os.environ.get('ANTHROPIC_BASE_URL')

  if auth_token and base_url:
    # Production: per-request client with user's token for FMAPI
    client = anthropic.AsyncAnthropic(
      api_key=auth_token,
      base_url=base_url,
    )
    model = os.environ.get('DATABRICKS_CLAUDE_MODEL', _FMAPI_MODEL)
    return client, model

  # Dev mode: cached client, direct Anthropic model
  client = _get_dev_client()
  if base_url:
    model = os.environ.get('DATABRICKS_CLAUDE_MODEL', _FMAPI_MODEL)
  else:
    model = _DIRECT_MODEL
  return client, model


async def generate_title(
  message: str,
  max_length: int = 40,
  auth_token: str | None = None,
) -> str:
  """Generate a concise title for a conversation.

  Args:
      message: The user's first message in the conversation
      max_length: Maximum length of the generated title
      auth_token: User's Databricks token for FMAPI auth

  Returns:
      A short, descriptive title (or truncated message as fallback)
  """
  # Fallback: truncate message
  fallback = message[:max_length].strip()
  if len(message) > max_length:
    fallback = fallback.rsplit(' ', 1)[0] + '...'

  try:
    client, model = _get_client(auth_token)

    response = await asyncio.wait_for(
      client.messages.create(
        model=model,
        max_tokens=50,
        messages=[
          {
            'role': 'user',
            'content': (
              'Generate a very short title (3-6 words max) '
              'for this chat message. The title should '
              'capture the main intent/topic. No quotes, '
              'no punctuation at the end.\n\n'
              f'Message: {message[:500]}\n\nTitle:'
            ),
          }
        ],
      ),
      timeout=5.0,  # 5 second timeout
    )

    # Extract title from response
    title = response.content[0].text.strip()

    # Clean up: remove quotes, limit length
    title = title.strip('"\'')
    if len(title) > max_length:
      title = title[:max_length].rsplit(' ', 1)[0] + '...'

    return title if title else fallback

  except asyncio.TimeoutError:
    logger.warning('Title generation timed out, using fallback')
    return fallback
  except Exception as e:
    logger.warning(f'Title generation failed: {e}, using fallback')
    return fallback


async def generate_title_async(
  message: str,
  conversation_id: str,
  user_email: str,
  project_id: str,
  auth_token: str | None = None,
) -> None:
  """Generate a title and update the conversation in the background.

  This runs in a fire-and-forget pattern so it doesn't block
  the main response.

  Args:
      message: The user's first message
      conversation_id: ID of the conversation to update
      user_email: User's email for storage access
      project_id: Project ID for storage access
      auth_token: User's Databricks token for FMAPI auth
  """
  try:
    title = await generate_title(message, auth_token=auth_token)

    # Update the conversation title
    from .storage import ConversationStorage

    storage = ConversationStorage(user_email, project_id)
    await storage.update_title(conversation_id, title)
    logger.info(f'Updated conversation {conversation_id} title to: {title}')

  except Exception as e:
    logger.warning(f'Failed to update conversation title: {e}')
