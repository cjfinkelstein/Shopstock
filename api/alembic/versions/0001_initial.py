"""Initial schema: users, trucks, locations, vendors, items, stock_levels, jobs, transactions.

Revision ID: 0001
Revises:
Create Date: 2026-07-24

"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("pin_hash", sa.String(200), nullable=True),
        sa.Column("email", sa.String(200), nullable=True, unique=True),
        sa.Column("password_hash", sa.String(200), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
    )
    op.create_table(
        "trucks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("assigned_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
    )
    op.create_table(
        "locations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("type", sa.String(10), nullable=False),
        sa.Column("truck_id", sa.Integer(), sa.ForeignKey("trucks.id"), nullable=True, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
    )
    op.create_table(
        "vendors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
    )
    op.create_table(
        "items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sku", sa.String(50), nullable=False, unique=True),
        sa.Column("barcode", sa.String(100), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("unit", sa.String(10), nullable=False),
        sa.Column("avg_cost", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.Column("last_cost", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.Column("reorder_point", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("reorder_qty", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        *_timestamps(),
    )
    op.create_index("ix_items_barcode", "items", ["barcode"])
    op.create_index("ix_items_category", "items", ["category"])
    op.create_table(
        "stock_levels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("locations.id"), nullable=False),
        sa.Column("qty", sa.Numeric(12, 2), nullable=False, server_default="0"),
        *_timestamps(),
        sa.UniqueConstraint("item_id", "location_id", name="uq_stock_item_location"),
    )
    op.create_index("ix_stock_levels_item_id", "stock_levels", ["item_id"])
    op.create_index("ix_stock_levels_location_id", "stock_levels", ["location_id"])
    op.create_table(
        "jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_number", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("customer", sa.String(200), nullable=True),
        sa.Column("address", sa.String(300), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="active"),
        *_timestamps(),
    )
    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("type", sa.String(10), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id"), nullable=False),
        sa.Column("qty", sa.Numeric(12, 2), nullable=False),
        sa.Column("from_location_id", sa.Integer(), sa.ForeignKey("locations.id"), nullable=True),
        sa.Column("to_location_id", sa.Integer(), sa.ForeignKey("locations.id"), nullable=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("jobs.id"), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
        sa.Column("unit_cost", sa.Numeric(10, 4), nullable=True),
        sa.Column("ref", sa.String(100), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("reason", sa.String(30), nullable=True),
        sa.Column("went_negative", sa.Boolean(), nullable=False, server_default=sa.false()),
        *_timestamps(),
    )
    op.create_index("ix_txn_item_created", "transactions", ["item_id", "created_at"])
    op.create_index("ix_txn_job", "transactions", ["job_id"])
    op.create_index("ix_txn_user", "transactions", ["user_id"])
    op.create_index("ix_txn_type_created", "transactions", ["type", "created_at"])


def downgrade() -> None:
    for table in ("transactions", "jobs", "stock_levels", "items", "vendors",
                  "locations", "trucks", "users"):
        op.drop_table(table)
