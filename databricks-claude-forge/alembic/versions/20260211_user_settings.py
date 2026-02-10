"""Add user_settings table for GitHub tokens.

Revision ID: 20260211_user_settings
Revises: 20260210_deployment_history
Create Date: 2026-02-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '20260211_user_settings'
down_revision: Union[str, None] = '20260210_deployment_history'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
  """Create user_settings table."""
  op.create_table(
    'user_settings',
    sa.Column('user_email', sa.String(255), primary_key=True),
    sa.Column('github_token_encrypted', sa.LargeBinary(), nullable=True),
    sa.Column('github_username', sa.String(255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
  )


def downgrade() -> None:
  """Drop user_settings table."""
  op.drop_table('user_settings')
