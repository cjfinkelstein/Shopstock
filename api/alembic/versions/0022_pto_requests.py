"""Add PTO request workflow fields to pto_entries: end_date (for a
multi-day range), status (pending/approved/denied), decided_by/decided_at.

Existing rows (all admin-logged so far) default to status="approved" via
server_default, since there's nothing to confirm for entries an admin
already entered directly.

Revision ID: 0022
Revises: 0021
Create Date: 2026-09-08

"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # decided_by is a plain (unconstrained) reference to users.id -- adding a
    # *named* FK via SQLite's batch table-recreation is more ceremony than
    # it's worth here, and the ORM model already declares the relationship
    # for querying/joining.
    with op.batch_alter_table("pto_entries") as batch_op:
        batch_op.add_column(sa.Column("end_date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("status", sa.String(10), nullable=False, server_default="approved"))
        batch_op.add_column(sa.Column("decided_by", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("decided_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("pto_entries") as batch_op:
        batch_op.drop_column("decided_at")
        batch_op.drop_column("decided_by")
        batch_op.drop_column("status")
        batch_op.drop_column("end_date")
