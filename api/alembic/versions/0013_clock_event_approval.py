"""Add approval workflow to clock_events -- shifts start pending until an admin approves them.

Existing shifts (recorded before this feature existed) are backfilled as
already-approved so admins aren't suddenly handed a queue of old history
to review.

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-02

"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("clock_events") as batch_op:
        batch_op.add_column(
            sa.Column("approval_status", sa.String(length=10), nullable=False, server_default="pending")
        )
        batch_op.add_column(sa.Column("approved_by_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("approved_at", sa.DateTime(), nullable=True))
        batch_op.create_foreign_key("fk_clock_events_approved_by_id", "users", ["approved_by_id"], ["id"])

    op.execute("UPDATE clock_events SET approval_status = 'approved'")


def downgrade() -> None:
    with op.batch_alter_table("clock_events") as batch_op:
        batch_op.drop_constraint("fk_clock_events_approved_by_id", type_="foreignkey")
        batch_op.drop_column("approved_at")
        batch_op.drop_column("approved_by_id")
        batch_op.drop_column("approval_status")
