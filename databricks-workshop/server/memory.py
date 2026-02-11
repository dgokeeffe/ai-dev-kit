"""Per-user memory persistence using Lakebase.

Saves and loads the workspace CLAUDE.md so returning users get their
accumulated context (resource notes, patterns learned, etc.) back.

Both functions are no-ops if Lakebase is not configured, and failures
are non-fatal - the app works identically to today without a database.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


async def load_user_memory(user_email: str, workspace_dir: str | Path) -> bool:
    """Load saved CLAUDE.md from Lakebase into the workspace directory.

    Must be called BEFORE prepare_session_environment() so that
    write_workshop_claude_md() sees the existing file and skips the
    template write.

    Returns True if a saved memory was loaded, False otherwise.
    """
    from .db.database import is_postgres_configured, session_scope
    from .db.models import UserMemory

    if not is_postgres_configured():
        return False

    try:
        from sqlalchemy import select

        async with session_scope() as session:
            result = await session.execute(
                select(UserMemory).where(UserMemory.user_email == user_email)
            )
            memory = result.scalar_one_or_none()

            if memory is None:
                logger.info("No saved memory for %s", user_email)
                return False

            # Write the saved CLAUDE.md to the workspace
            workspace = Path(workspace_dir)
            workspace.mkdir(parents=True, exist_ok=True)
            claude_md_path = workspace / "CLAUDE.md"
            claude_md_path.write_text(memory.claude_md, encoding="utf-8")

            logger.info(
                "Loaded saved memory for %s (%d bytes)",
                user_email,
                len(memory.claude_md),
            )
            return True

    except Exception as e:
        logger.warning("Failed to load user memory (non-fatal): %s", e)
        return False


async def save_user_memory(user_email: str, workspace_dir: str | Path) -> bool:
    """Read the workspace CLAUDE.md and upsert to Lakebase.

    Uses INSERT ON CONFLICT UPDATE for last-write-wins semantics
    when multiple sessions exist for the same user.

    Returns True if saved successfully, False otherwise.
    """
    from .db.database import is_postgres_configured, session_scope
    from .db.models import UserMemory, utc_now

    if not is_postgres_configured():
        return False

    try:
        claude_md_path = Path(workspace_dir) / "CLAUDE.md"
        if not claude_md_path.exists():
            logger.info("No CLAUDE.md to save for %s", user_email)
            return False

        content = claude_md_path.read_text(encoding="utf-8")
        if not content.strip():
            logger.info("Empty CLAUDE.md for %s, skipping save", user_email)
            return False

        from sqlalchemy.dialects.postgresql import insert

        async with session_scope() as session:
            stmt = insert(UserMemory).values(
                user_email=user_email,
                claude_md=content,
                updated_at=utc_now(),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["user_email"],
                set_={
                    "claude_md": stmt.excluded.claude_md,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
            await session.execute(stmt)

        logger.info(
            "Saved memory for %s (%d bytes)",
            user_email,
            len(content),
        )
        return True

    except Exception as e:
        logger.warning("Failed to save user memory (non-fatal): %s", e)
        return False
