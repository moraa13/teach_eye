"""Initial schema — Sessions 1 & 2: students, sessions, tasks, submissions.

Revision ID: 001
Revises: None
Create Date: 2026-03-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # All tables are created with create_all() on first run; these op.create_table calls
    # use if_not_exists via the batch context so they are safe to re-run on existing DBs.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = inspector.get_table_names()

    if "students" not in existing:
        op.create_table(
            "students",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("name", sa.String, nullable=False, unique=True),
            sa.Column("created_at", sa.DateTime),
        )

    if "sessions" not in existing:
        op.create_table(
            "sessions",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("student_id", sa.Integer, sa.ForeignKey("students.id"), nullable=False),
            sa.Column("start_time", sa.DateTime),
            sa.Column("end_time", sa.DateTime, nullable=True),
            sa.Column("status", sa.String, server_default="active"),
        )

    if "tasks" not in existing:
        op.create_table(
            "tasks",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("title", sa.String, nullable=False),
            sa.Column("task_type", sa.String),
        )

    if "submissions" not in existing:
        op.create_table(
            "submissions",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("session_id", sa.Integer, sa.ForeignKey("sessions.id"), nullable=False),
            sa.Column("task_id", sa.Integer, sa.ForeignKey("tasks.id"), nullable=True),
            sa.Column("solution_text", sa.Text),
            sa.Column("submitted_at", sa.DateTime),
        )


def downgrade() -> None:
    op.drop_table("submissions")
    op.drop_table("tasks")
    op.drop_table("sessions")
    op.drop_table("students")
