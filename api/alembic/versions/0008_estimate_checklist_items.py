"""Add estimate_checklist_items table (saved custom wizard checklist entries).

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-13

"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "estimate_checklist_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("section", sa.String(100), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("section", "label", name="uq_checklist_section_label"),
    )
    op.create_index("ix_estimate_checklist_items_section", "estimate_checklist_items", ["section"])


def downgrade() -> None:
    op.drop_index("ix_estimate_checklist_items_section", table_name="estimate_checklist_items")
    op.drop_table("estimate_checklist_items")
