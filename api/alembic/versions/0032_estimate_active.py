"""Add estimates.active (soft-delete).

Matches every other deletable row in this app -- "Delete" now hides an
estimate (filtered out of list/get/public-share lookups) instead of
removing it, so an accidental delete doesn't lose real work with no way
back. Also makes delete instant: no more bulk-deleting a plan's markers/
lines/pages/sections first, just one UPDATE.

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-23

"""
from alembic import op
import sqlalchemy as sa

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("estimates") as batch_op:
        batch_op.add_column(sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    with op.batch_alter_table("estimates") as batch_op:
        batch_op.drop_column("active")
