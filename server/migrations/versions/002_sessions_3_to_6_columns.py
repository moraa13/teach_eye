"""Add columns introduced in Sessions 3–6.

Sessions 3–4: submissions.ai_feedback, tasks.image_data/solution_code/ai_analysis
Session 5: students.last_seen

Revision ID: 002
Revises: 001
Create Date: 2026-03-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns(table)]
    return column in cols


def upgrade() -> None:
    # Each addition is guarded so the migration is idempotent on databases that
    # already had _add_column_if_missing applied in earlier sessions.
    if not _column_exists("submissions", "ai_feedback"):
        with op.batch_alter_table("submissions") as batch_op:
            batch_op.add_column(sa.Column("ai_feedback", sa.Text, nullable=True))

    if not _column_exists("tasks", "image_data"):
        with op.batch_alter_table("tasks") as batch_op:
            batch_op.add_column(sa.Column("image_data", sa.LargeBinary, nullable=True))

    if not _column_exists("tasks", "solution_code"):
        with op.batch_alter_table("tasks") as batch_op:
            batch_op.add_column(sa.Column("solution_code", sa.Text, nullable=True))

    if not _column_exists("tasks", "ai_analysis"):
        with op.batch_alter_table("tasks") as batch_op:
            batch_op.add_column(sa.Column("ai_analysis", sa.Text, nullable=True))

    if not _column_exists("students", "last_seen"):
        with op.batch_alter_table("students") as batch_op:
            batch_op.add_column(sa.Column("last_seen", sa.DateTime, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("students") as batch_op:
        batch_op.drop_column("last_seen")
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("ai_analysis")
        batch_op.drop_column("solution_code")
        batch_op.drop_column("image_data")
    with op.batch_alter_table("submissions") as batch_op:
        batch_op.drop_column("ai_feedback")
