"""Add login_events table (tap-in / admin login log, for the calendar report).

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-29

"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "login_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_login_events_created", "login_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_login_events_created", table_name="login_events")
    op.drop_table("login_events")
