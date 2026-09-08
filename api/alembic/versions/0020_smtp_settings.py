"""Add smtp_settings table (admin-configurable outbound email, in place of
env-var-only SMTP_* config).

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-08

"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "smtp_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("host", sa.String(200), nullable=True),
        sa.Column("port", sa.Integer(), nullable=False, server_default="587"),
        sa.Column("use_tls", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("username", sa.String(200), nullable=True),
        sa.Column("password", sa.Text(), nullable=True),
        sa.Column("from_address", sa.String(200), nullable=True),
        sa.Column("from_name", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("smtp_settings")
