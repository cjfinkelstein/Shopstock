"""Add clock_out_photos table.

A tech can attach photos (with an optional caption each) to their own
clock-out, alongside the existing clock_out_note. Admin-visible only,
same as the note. The actual image bytes live on disk under
settings.uploads_dir (a mounted Docker volume in production, not in
the database) -- this table just tracks the path, caption, and who
uploaded it.

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clock_out_photos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("clock_event_id", sa.Integer(), sa.ForeignKey("clock_events.id"), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("caption", sa.String(300), nullable=True),
        sa.Column("file_path", sa.String(300), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_clock_out_photos_clock_event", "clock_out_photos", ["clock_event_id"])


def downgrade() -> None:
    op.drop_index("ix_clock_out_photos_clock_event", table_name="clock_out_photos")
    op.drop_table("clock_out_photos")
