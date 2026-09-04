"""Add visibility to calendar_events (shared vs admin_only).

Existing rows are all from the shared Team Calendar, so they default to
"shared" -- server_default backfills existing rows, nullable=False after.

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-04

"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("calendar_events") as batch_op:
        batch_op.add_column(
            sa.Column("visibility", sa.String(10), nullable=False, server_default="shared")
        )


def downgrade() -> None:
    with op.batch_alter_table("calendar_events") as batch_op:
        batch_op.drop_column("visibility")
