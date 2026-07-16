"""Add a canonical display name to users.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("full_name", sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE users AS u
        SET full_name = COALESCE(cp.full_name, d.full_name)
        FROM client_profiles AS cp
        FULL JOIN drivers AS d ON d.user_id = cp.user_id
        WHERE u.id = COALESCE(cp.user_id, d.user_id)
          AND u.full_name IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("users", "full_name")
