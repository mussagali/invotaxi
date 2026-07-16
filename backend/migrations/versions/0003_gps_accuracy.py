"""Persist horizontal GPS accuracy.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "driver_track_history",
        sa.Column("accuracy_m", sa.Float(precision=53), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("driver_track_history", "accuracy_m")
