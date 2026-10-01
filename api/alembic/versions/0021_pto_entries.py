"""Add pto_entries table (tracks logged vacation/personal days against each
tech's annual handbook allotment).

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-08

"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pto_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("category", sa.String(10), nullable=False),
        sa.Column("days", sa.Numeric(4, 2), nullable=False, server_default="1"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_pto_entries_user", "pto_entries", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_pto_entries_user", table_name="pto_entries")
    op.drop_table("pto_entries")
