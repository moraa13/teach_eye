"""Add Lesson Mode foundation tables.

Session 11: TeachEye grows beyond classic task submissions and gains a reusable lesson library,
live lesson runs, per-student runtime state, and embedded Python code-run history.

Revision ID: 006
Revises: 005
Create Date: 2026-04-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = inspector.get_table_names()

    if "lessons" not in existing:
        op.create_table(
            "lessons",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("title", sa.String, nullable=False),
            sa.Column("grade_band", sa.String, nullable=True),
            sa.Column("topic", sa.String, nullable=True),
            sa.Column("level", sa.String, nullable=True),
            sa.Column("author_name", sa.String, nullable=True),
            sa.Column("summary", sa.Text, nullable=True),
            sa.Column("tags_json", sa.Text, nullable=True),
            sa.Column("status", sa.String, server_default="draft"),
            sa.Column("is_template", sa.Boolean, server_default=sa.true(), nullable=False),
            sa.Column("created_at", sa.DateTime),
            sa.Column("updated_at", sa.DateTime),
        )

    if "lesson_scenes" not in existing:
        op.create_table(
            "lesson_scenes",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("lesson_id", sa.Integer, sa.ForeignKey("lessons.id"), nullable=False),
            sa.Column("title", sa.String, nullable=False),
            sa.Column("scene_type", sa.String, server_default="board"),
            sa.Column("order_index", sa.Integer, server_default="0"),
            sa.Column("layout_json", sa.Text, nullable=True),
            sa.Column("notes_text", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime),
        )

    if "lesson_widgets" not in existing:
        op.create_table(
            "lesson_widgets",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("scene_id", sa.Integer, sa.ForeignKey("lesson_scenes.id"), nullable=False),
            sa.Column("widget_type", sa.String, nullable=False),
            sa.Column("title", sa.String, nullable=True),
            sa.Column("order_index", sa.Integer, server_default="0"),
            sa.Column("layout_json", sa.Text, nullable=True),
            sa.Column("config_json", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime),
        )

    if "lesson_runs" not in existing:
        op.create_table(
            "lesson_runs",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("lesson_id", sa.Integer, sa.ForeignKey("lessons.id"), nullable=False),
            sa.Column("class_name", sa.String, nullable=True),
            sa.Column("status", sa.String, server_default="active"),
            sa.Column("current_scene_index", sa.Integer, server_default="0"),
            sa.Column("highest_unlocked_scene_index", sa.Integer, server_default="0"),
            sa.Column("teacher_state_json", sa.Text, nullable=True),
            sa.Column("started_at", sa.DateTime),
            sa.Column("ended_at", sa.DateTime, nullable=True),
        )

    if "lesson_participant_states" not in existing:
        op.create_table(
            "lesson_participant_states",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("lesson_run_id", sa.Integer, sa.ForeignKey("lesson_runs.id"), nullable=False),
            sa.Column("session_id", sa.Integer, sa.ForeignKey("sessions.id"), nullable=False),
            sa.Column("current_scene_index", sa.Integer, server_default="0"),
            sa.Column("highest_unlocked_scene_index", sa.Integer, server_default="0"),
            sa.Column("stars_tenths", sa.Integer, server_default="0"),
            sa.Column("activity_points", sa.Integer, server_default="0"),
            sa.Column("preview_json", sa.Text, nullable=True),
            sa.Column("progress_json", sa.Text, nullable=True),
            sa.Column("last_event_at", sa.DateTime),
            sa.Column("last_preview_at", sa.DateTime, nullable=True),
            sa.UniqueConstraint("lesson_run_id", "session_id", name="uq_lesson_run_session"),
        )

    if "code_runs" not in existing:
        op.create_table(
            "code_runs",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("participant_state_id", sa.Integer, sa.ForeignKey("lesson_participant_states.id"), nullable=False),
            sa.Column("scene_id", sa.Integer, sa.ForeignKey("lesson_scenes.id"), nullable=True),
            sa.Column("source_code", sa.Text, nullable=False),
            sa.Column("status", sa.String, server_default="ok"),
            sa.Column("exit_code", sa.Integer, nullable=True),
            sa.Column("stdout_text", sa.Text, nullable=True),
            sa.Column("stderr_text", sa.Text, nullable=True),
            sa.Column("friendly_error", sa.Text, nullable=True),
            sa.Column("duration_ms", sa.Integer, nullable=True),
            sa.Column("created_at", sa.DateTime),
        )


def downgrade() -> None:
    op.drop_table("code_runs")
    op.drop_table("lesson_participant_states")
    op.drop_table("lesson_runs")
    op.drop_table("lesson_widgets")
    op.drop_table("lesson_scenes")
    op.drop_table("lessons")
