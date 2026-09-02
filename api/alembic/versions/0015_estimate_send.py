"""Add customer-facing estimate send/respond tracking.

All additive/nullable -- no existing data touched. Existing estimates get
customer_email/share_token/sent_at/responded_at = NULL until first sent.

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-02

"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("estimates") as batch_op:
        batch_op.add_column(sa.Column("customer_email", sa.String(200), nullable=True))
        batch_op.add_column(sa.Column("share_token", sa.String(64), nullable=True))
        batch_op.add_column(sa.Column("sent_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("responded_at", sa.DateTime(), nullable=True))
    op.create_index("ix_estimates_share_token", "estimates", ["share_token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_estimates_share_token", table_name="estimates")
    with op.batch_alter_table("estimates") as batch_op:
        batch_op.drop_column("responded_at")
        batch_op.drop_column("sent_at")
        batch_op.drop_column("share_token")
        batch_op.drop_column("customer_email")
