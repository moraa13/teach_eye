"""Add class_name to students; replace per-name unique with composite (name, class_name).

Session 9: students now carry the class they belong to (e.g. "8А", "9Я") so two students
with the same ФИО in different classes are stored as separate records.
The unique constraint moves from name alone to (name, class_name).

Revision ID: 004
Revises: 003
Create Date: 2026-03-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns(table)]
    return column in cols


def upgrade() -> None:
    # Step 1: add class_name column (empty string default for legacy rows).
    if not _column_exists("students", "class_name"):
        with op.batch_alter_table("students") as batch_op:
            batch_op.add_column(
                sa.Column("class_name", sa.String, nullable=False, server_default="")
            )

    # Step 2: rebuild the students table to swap the unique constraint.
    # recreate="always" forces SQLite to copy → drop → rename, which lets us
    # drop the old single-column unique index on 'name' and add the composite one.
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Find the index that enforces uniqueness on 'name' alone (may be unnamed in SQLite).
    old_unique_idx = next(
        (
            idx["name"]
            for idx in inspector.get_indexes("students")
            if idx.get("unique") and idx["column_names"] == ["name"] and idx.get("name")
        ),
        None,
    )

    with op.batch_alter_table("students", recreate="always") as batch_op:
        if old_unique_idx:
            batch_op.drop_index(old_unique_idx)
        # Composite unique: same ФИО allowed across classes, blocked within one class.
        batch_op.create_unique_constraint("uq_student_name_class", ["name", "class_name"])


def downgrade() -> None:
    with op.batch_alter_table("students", recreate="always") as batch_op:
        batch_op.drop_constraint("uq_student_name_class", type_="unique")
        batch_op.drop_column("class_name")
        batch_op.create_unique_constraint("uq_students_name", ["name"])
