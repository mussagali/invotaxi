"""Add guardian dependents and grouped family-order passengers.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dependents",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("guardian_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("needs_escort", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["guardian_id"], ["client_profiles.user_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dependents_guardian_id", "dependents", ["guardian_id"], unique=False)
    op.create_index(
        "ix_dependents_guardian_active", "dependents", ["guardian_id", "is_active"], unique=False
    )
    op.add_column(
        "orders",
        sa.Column(
            "dependent_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "orders",
        sa.Column(
            "passenger_names",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.drop_constraint("seats_1_or_2", "orders", type_="check")
    op.create_check_constraint("seats_1_to_6", "orders", "seats BETWEEN 1 AND 6")


def downgrade() -> None:
    op.drop_constraint("seats_1_to_6", "orders", type_="check")
    op.create_check_constraint("seats_1_or_2", "orders", "seats IN (1, 2)")
    op.drop_column("orders", "passenger_names")
    op.drop_column("orders", "dependent_ids")
    op.drop_index("ix_dependents_guardian_active", table_name="dependents")
    op.drop_index("ix_dependents_guardian_id", table_name="dependents")
    op.drop_table("dependents")
