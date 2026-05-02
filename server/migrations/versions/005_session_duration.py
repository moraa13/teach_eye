"""Add duration_seconds column to sessions table.

Session 10: the teacher can now configure the session duration in the Teacher Panel
before students log in. Each session bakes in its own duration so changing the setting
mid-lesson does not retroactively alter sessions already in progress.

Revision ID: 005
Revises: 004
Create Date: 2026-03-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns(table)]
    return column in cols


def upgrade() -> None:
    if not _column_exists("sessions", "duration_seconds"):
        with op.batch_alter_table("sessions") as batch_op:
            batch_op.add_column(sa.Column("duration_seconds", sa.Integer, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sessions") as batch_op:
        batch_op.drop_column("duration_seconds")
