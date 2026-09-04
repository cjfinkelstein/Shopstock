"""Add clock_out_note to clock_events.

Additive/nullable -- existing shifts get NULL until re-clocked.

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-04

"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("clock_events") as batch_op:
        batch_op.add_column(sa.Column("clock_out_note", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("clock_events") as batch_op:
        batch_op.drop_column("clock_out_note")
