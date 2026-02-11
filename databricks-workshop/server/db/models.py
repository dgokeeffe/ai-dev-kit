"""Database models for workshop memory persistence."""

from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    """Return the current UTC datetime."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """Base class for SQLAlchemy models."""

    pass


class UserMemory(Base):
    """Persists the evolved CLAUDE.md per user across sessions.

    Uses INSERT ON CONFLICT UPDATE (last-write-wins) so concurrent
    sessions for the same user don't cause errors.
    """

    __tablename__ = "user_memories"

    user_email: Mapped[str] = mapped_column(
        String(255), primary_key=True
    )
    claude_md: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )
