# [VIBE-CONTEXT]
# Role: DB bootstrap script for Teacher's Eye — creates all tables without inserting any data.
# State: Session 4 — tasks are no longer seeded; teachers upload them via the teacher panel.
# Why: An empty task table is correct now; the teacher fills it at runtime via POST /tasks.

"""
Usage (run once from the project root before starting the server):

    python -m server.seed

Safe to re-run — create_all is idempotent.
"""

from server.models import Base, engine


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    print("DB tables created (or already exist). No tasks seeded — use the teacher panel to add tasks.")


if __name__ == "__main__":
    seed()
