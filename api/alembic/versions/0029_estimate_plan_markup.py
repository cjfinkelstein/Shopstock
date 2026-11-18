"""Add estimate_plan_pages and estimate_plan_markers tables.

Backs the plan markup step of the estimate wizard: an uploaded plan PDF is
rendered into estimate_plan_pages (one row per page, image stored the same
way Item.image_data already is), and estimate_plan_markers holds each
clicked/dragged symbol pin on a page (x/y as percent offsets so position
survives any display size), optionally linked to a real catalog item for
pricing.

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-18

"""
from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "estimate_plan_pages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("estimate_id", sa.Integer(), sa.ForeignKey("estimates.id"), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("image_data", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_estimate_plan_pages_estimate", "estimate_plan_pages", ["estimate_id"])

    op.create_table(
        "estimate_plan_markers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("plan_page_id", sa.Integer(), sa.ForeignKey("estimate_plan_pages.id"), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id"), nullable=True),
        sa.Column("symbol_type", sa.String(10), nullable=False),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("qty", sa.Numeric(12, 2), nullable=False, server_default="1"),
        sa.Column("x", sa.Numeric(5, 2), nullable=False),
        sa.Column("y", sa.Numeric(5, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_estimate_plan_markers_page", "estimate_plan_markers", ["plan_page_id"])


def downgrade() -> None:
    op.drop_index("ix_estimate_plan_markers_page", table_name="estimate_plan_markers")
    op.drop_table("estimate_plan_markers")
    op.drop_index("ix_estimate_plan_pages_estimate", table_name="estimate_plan_pages")
    op.drop_table("estimate_plan_pages")
