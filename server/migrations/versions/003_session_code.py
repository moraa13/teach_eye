"""Add session_code column to sessions table.

Session 8: each session is assigned a short 2-digit numeric code on login
so the teacher can visually verify which student is which on the dashboard.

Revision ID: 003
Revises: 002
Create Date: 2026-03-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns(table)]
    return column in cols


def upgrade() -> None:
    if not _column_exists("sessions", "session_code"):
        with op.batch_alter_table("sessions") as batch_op:
            batch_op.add_column(sa.Column("session_code", sa.Integer, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sessions") as batch_op:
        batch_op.drop_column("session_code")
