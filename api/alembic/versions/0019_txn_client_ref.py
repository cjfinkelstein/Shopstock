"""Add client_ref to transactions for write idempotency.

Nullable, unique (a unique index allows any number of NULLs on both
SQLite and Postgres) -- lets a client-generated key on a queued offline
sign-out/return/transfer make a retried request replay the original
result instead of writing twice. Existing rows get NULL, which is
correct: they predate this and were never at risk of a retry.

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-30

"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.add_column(sa.Column("client_ref", sa.String(64), nullable=True))
        batch_op.create_index("ix_txn_client_ref", ["client_ref"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.drop_index("ix_txn_client_ref")
        batch_op.drop_column("client_ref")
