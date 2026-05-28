"""add_rfid_settings_to_app_settings

Add rfid_extended_data_enabled and rfid_protocol columns to app_settings.

Revision ID: add_rfid_settings
Revises: remove_ams_fields
Create Date: 2026-05-28 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_rfid_settings'
down_revision: Union[str, Sequence[str], None] = 'b8d4e0f2c3a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('app_settings') as batch_op:
        batch_op.add_column(sa.Column('rfid_extended_data_enabled', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('rfid_protocol', sa.String(20), nullable=False, server_default='openspool'))


def downgrade() -> None:
    with op.batch_alter_table('app_settings') as batch_op:
        batch_op.drop_column('rfid_protocol')
        batch_op.drop_column('rfid_extended_data_enabled')
