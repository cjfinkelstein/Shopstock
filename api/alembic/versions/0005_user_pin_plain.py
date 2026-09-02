"""Add plaintext pin mirror on users (so admin can always view a tech's current PIN).

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-30

"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("pin", sa.String(4), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "pin")
