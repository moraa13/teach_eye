"""Harden Lesson Mode runtime storage.

Session 15: live lesson runs now freeze their lesson payload at start time, participant progress
gets an explicit version counter, star adjustments become auditable, and the hottest runtime
queries gain dedicated indexes for the teacher board / preview wall.

Revision ID: 007
Revises: 006
Create Date: 2026-04-25
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns(table)]
    return column in cols


def _table_exists(table: str) -> bool:
    bind = op.get_bind()
    return table in sa.inspect(bind).get_table_names()


def _index_exists(table: str, index_name: str) -> bool:
    bind = op.get_bind()
    indexes = sa.inspect(bind).get_indexes(table)
    return any(index.get("name") == index_name for index in indexes)


def upgrade() -> None:
    if not _column_exists("lesson_runs", "lesson_snapshot_json"):
        with op.batch_alter_table("lesson_runs") as batch_op:
            batch_op.add_column(sa.Column("lesson_snapshot_json", sa.Text(), nullable=True))

    if not _column_exists("lesson_participant_states", "progress_version"):
        with op.batch_alter_table("lesson_participant_states") as batch_op:
            batch_op.add_column(
                sa.Column("progress_version", sa.Integer(), nullable=False, server_default="0")
            )

    if not _table_exists("lesson_star_events"):
        op.create_table(
            "lesson_star_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "participant_state_id",
                sa.Integer(),
                sa.ForeignKey("lesson_participant_states.id"),
                nullable=False,
            ),
            sa.Column("delta_tenths", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("source", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )

    if not _index_exists("lesson_runs", "ix_lesson_runs_lesson_status"):
        op.create_index(
            "ix_lesson_runs_lesson_status",
            "lesson_runs",
            ["lesson_id", "status"],
            unique=False,
        )

    if not _index_exists("lesson_participant_states", "ix_lesson_participant_states_run"):
        op.create_index(
            "ix_lesson_participant_states_run",
            "lesson_participant_states",
            ["lesson_run_id"],
            unique=False,
        )

    if not _index_exists("lesson_participant_states", "ix_lesson_participant_states_session"):
        op.create_index(
            "ix_lesson_participant_states_session",
            "lesson_participant_states",
            ["session_id"],
            unique=False,
        )

    if not _index_exists("code_runs", "ix_code_runs_participant_created"):
        op.create_index(
            "ix_code_runs_participant_created",
            "code_runs",
            ["participant_state_id", "created_at"],
            unique=False,
        )

    if not _index_exists("lesson_star_events", "ix_lesson_star_events_participant_created"):
        op.create_index(
            "ix_lesson_star_events_participant_created",
            "lesson_star_events",
            ["participant_state_id", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    if _index_exists("lesson_star_events", "ix_lesson_star_events_participant_created"):
        op.drop_index("ix_lesson_star_events_participant_created", table_name="lesson_star_events")
    if _table_exists("lesson_star_events"):
        op.drop_table("lesson_star_events")

    if _index_exists("code_runs", "ix_code_runs_participant_created"):
        op.drop_index("ix_code_runs_participant_created", table_name="code_runs")

    if _index_exists("lesson_participant_states", "ix_lesson_participant_states_session"):
        op.drop_index("ix_lesson_participant_states_session", table_name="lesson_participant_states")
    if _index_exists("lesson_participant_states", "ix_lesson_participant_states_run"):
        op.drop_index("ix_lesson_participant_states_run", table_name="lesson_participant_states")
    if _column_exists("lesson_participant_states", "progress_version"):
        with op.batch_alter_table("lesson_participant_states") as batch_op:
            batch_op.drop_column("progress_version")

    if _index_exists("lesson_runs", "ix_lesson_runs_lesson_status"):
        op.drop_index("ix_lesson_runs_lesson_status", table_name="lesson_runs")
    if _column_exists("lesson_runs", "lesson_snapshot_json"):
        with op.batch_alter_table("lesson_runs") as batch_op:
            batch_op.drop_column("lesson_snapshot_json")
