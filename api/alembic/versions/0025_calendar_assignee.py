"""Add assignee to calendar_events.

Nullable free-text name (not a User foreign key) -- lets Ray write a
per-person task list for a date (e.g. "Adam", "Ed", "Avigdor") without
tying it to exact User.name matching, which already bit us once this
session (Ray's real account name is "Raymond Bailey", not "Ray"). A
plain label Ray types himself sidesteps that whole class of bug.
Existing rows get NULL, which is correct -- they're ordinary shared
to-dos, not assigned to anyone.

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("calendar_events") as batch_op:
        batch_op.add_column(sa.Column("assignee", sa.String(50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("calendar_events") as batch_op:
        batch_op.drop_column("assignee")
