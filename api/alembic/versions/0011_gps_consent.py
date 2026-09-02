"""Add gps_consent_at to users -- records when a tech agreed to GPS-while-clocked-in tracking.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-01

"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("gps_consent_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("gps_consent_at")
