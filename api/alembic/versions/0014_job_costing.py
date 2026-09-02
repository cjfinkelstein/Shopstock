"""Add job-costing: hourly pay rates, general expenses, and job revenue.

All additive/nullable -- no existing data touched. users.hourly_rate starts
NULL on every existing row (treated as "not set yet", not $0/hr). The two
new tables start empty.

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-02

"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("hourly_rate", sa.Numeric(10, 2), nullable=True))

    op.create_table(
        "expenses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("jobs.id"), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("receipt_filename", sa.String(255), nullable=True),
        sa.Column("receipt_mime_type", sa.String(100), nullable=True),
        sa.Column("receipt_data", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_expenses_job", "expenses", ["job_id"])
    op.create_index("ix_expenses_date", "expenses", ["expense_date"])

    op.create_table(
        "job_revenues",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("jobs.id"), nullable=False),
        sa.Column("received_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("ref", sa.String(100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_job_revenues_job", "job_revenues", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_job_revenues_job", table_name="job_revenues")
    op.drop_table("job_revenues")
    op.drop_index("ix_expenses_date", table_name="expenses")
    op.drop_index("ix_expenses_job", table_name="expenses")
    op.drop_table("expenses")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("hourly_rate")
