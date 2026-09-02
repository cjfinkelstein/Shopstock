"""Add job_id to clock_events -- techs pick which job they're clocking into.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-02

"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("clock_events") as batch_op:
        batch_op.add_column(sa.Column("job_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_clock_events_job_id", "jobs", ["job_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("clock_events") as batch_op:
        batch_op.drop_constraint("fk_clock_events_job_id", type_="foreignkey")
        batch_op.drop_column("job_id")
