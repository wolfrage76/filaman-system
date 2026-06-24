"""add_spool_core_weight

Add spool_core_weight_g column to spools table.

Revision ID: add_spool_core_weight
Revises: add_rfid_settings
Create Date: 2026-06-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'add_spool_core_weight'
down_revision: Union[str, Sequence[str], None] = 'add_rfid_settings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('spools') as batch_op:
        batch_op.add_column(sa.Column('spool_core_weight_g', sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('spools') as batch_op:
        batch_op.drop_column('spool_core_weight_g')
