"""Rebuild estimates to match APEX's real format: fixed phase sections,
separate material/labor cost per line, profit % + discount % (replaces the
earlier flat labor_hours/labor_rate/markup_pct guess -- no real estimate data
exists yet, so this drops and recreates rather than migrating in place).

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-13

"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("estimate_lines")
    op.drop_table("estimates")

    op.create_table(
        "estimates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("estimate_number", sa.String(50), nullable=False, unique=True),
        sa.Column("customer", sa.String(200)),
        sa.Column("address", sa.String(300)),
        sa.Column("scope_of_work", sa.Text(), nullable=False),
        sa.Column("exclusions", sa.Text()),
        sa.Column("status", sa.String(10), nullable=False, server_default="draft"),
        sa.Column("profit_pct", sa.Numeric(6, 2), nullable=False, server_default="0"),
        sa.Column("discount_pct", sa.Numeric(6, 2), nullable=False, server_default="0"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "estimate_sections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("estimate_id", sa.Integer(), sa.ForeignKey("estimates.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_estimate_sections_estimate", "estimate_sections", ["estimate_id"])
    op.create_table(
        "estimate_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("section_id", sa.Integer(), sa.ForeignKey("estimate_sections.id"), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id")),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("qty", sa.Numeric(12, 2), nullable=False, server_default="1"),
        sa.Column("unit", sa.String(10), nullable=False, server_default="each"),
        sa.Column("material_unit_cost", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("labor_unit_cost", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_estimate_lines_section", "estimate_lines", ["section_id"])


def downgrade() -> None:
    op.drop_index("ix_estimate_lines_section", table_name="estimate_lines")
    op.drop_table("estimate_lines")
    op.drop_index("ix_estimate_sections_estimate", table_name="estimate_sections")
    op.drop_table("estimate_sections")
    op.drop_table("estimates")

    op.create_table(
        "estimates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("estimate_number", sa.String(50), nullable=False, unique=True),
        sa.Column("customer", sa.String(200)),
        sa.Column("address", sa.String(300)),
        sa.Column("scope_of_work", sa.Text(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="draft"),
        sa.Column("markup_pct", sa.Numeric(6, 2), nullable=False, server_default="0"),
        sa.Column("labor_hours", sa.Numeric(8, 2), nullable=False, server_default="0"),
        sa.Column("labor_rate", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "estimate_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("estimate_id", sa.Integer(), sa.ForeignKey("estimates.id"), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id")),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("qty", sa.Numeric(12, 2), nullable=False, server_default="1"),
        sa.Column("unit", sa.String(10), nullable=False, server_default="each"),
        sa.Column("unit_price", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_estimate_lines_estimate", "estimate_lines", ["estimate_id"])
