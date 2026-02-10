"""Add deployment_history table.

Revision ID: 20260210_deployment_history
Revises: 20260115_warehouse_workspace
Create Date: 2026-02-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '20260210_deployment_history'
down_revision: Union[str, None] = '20260115_warehouse_workspace'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
  """Create deployment_history table."""
  op.create_table(
    'deployment_history',
    sa.Column('id', sa.String(50), primary_key=True),
    sa.Column(
      'project_id',
      sa.String(50),
      sa.ForeignKey('projects.id', ondelete='CASCADE'),
      nullable=False,
      index=True,
    ),
    sa.Column('target', sa.String(50), nullable=False),
    sa.Column('app_name', sa.String(255), nullable=False),
    sa.Column('app_url', sa.String(500), nullable=True),
    sa.Column('status', sa.String(20), nullable=False),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('logs_json', sa.Text(), nullable=False, server_default='[]'),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
  )


def downgrade() -> None:
  """Drop deployment_history table."""
  op.drop_table('deployment_history')
