"""add_ui_version_to_app_settings

Add ui_version column to app_settings. Selects which frontend the app
serves by default: "v1" (classic) or "v2" (redesigned console).

Revision ID: add_ui_version
Revises: a4d1c8b7e903
Create Date: 2026-09-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'add_ui_version'
down_revision: Union[str, Sequence[str], None] = 'a4d1c8b7e903'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('app_settings') as batch_op:
        batch_op.add_column(
            sa.Column('ui_version', sa.String(length=8), nullable=False, server_default='v1')
        )


def downgrade() -> None:
    with op.batch_alter_table('app_settings') as batch_op:
        batch_op.drop_column('ui_version')
