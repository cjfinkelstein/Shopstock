"""Add password-reset token fields to users.

Additive/nullable -- existing users get NULL until they request a reset.

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-08

"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("reset_token", sa.String(64), nullable=True))
        batch_op.add_column(sa.Column("reset_token_expires_at", sa.DateTime(), nullable=True))
    op.create_index("ix_users_reset_token", "users", ["reset_token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_reset_token", table_name="users")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("reset_token_expires_at")
        batch_op.drop_column("reset_token")
