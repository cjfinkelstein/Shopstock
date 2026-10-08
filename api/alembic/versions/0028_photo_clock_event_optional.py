"""Make clock_out_photos.clock_event_id nullable.

A tech can now add a photo any time -- clocked in or out -- not just
during the clock-out flow. When no shift is open at upload time,
clock_event_id is NULL and the photo just belongs to the uploader; the
feed falls back to the upload timestamp for its date in that case.

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-08

"""
from alembic import op
import sqlalchemy as sa

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("clock_out_photos") as batch_op:
        batch_op.alter_column("clock_event_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    # Best-effort: fails if any photo was uploaded off-shift (NULL
    # clock_event_id) since there's no shift to backfill it with.
    with op.batch_alter_table("clock_out_photos") as batch_op:
        batch_op.alter_column("clock_event_id", existing_type=sa.Integer(), nullable=False)
