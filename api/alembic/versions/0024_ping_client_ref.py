"""Add client_ref to location_pings for write idempotency.

Nullable, unique (a unique index allows any number of NULLs on both
SQLite and Postgres) -- lets a client-generated key on a queued offline
GPS ping make a retried request replay instead of writing a duplicate
point into the shift's route. Existing rows get NULL, which is correct:
they predate this and were never at risk of a retry.

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-01

"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("location_pings") as batch_op:
        batch_op.add_column(sa.Column("client_ref", sa.String(64), nullable=True))
        batch_op.create_index("ix_location_pings_client_ref", ["client_ref"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("location_pings") as batch_op:
        batch_op.drop_index("ix_location_pings_client_ref")
        batch_op.drop_column("client_ref")
