"""Add shared team calendar/to-do list with per-field edit history.

Two new tables, nothing existing touched.

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-04

"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_calendar_events_date", "calendar_events", ["event_date"])

    op.create_table(
        "calendar_event_edits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("calendar_events.id"), nullable=False),
        sa.Column("edited_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("field", sa.String(20), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_calendar_event_edits_event", "calendar_event_edits", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_calendar_event_edits_event", table_name="calendar_event_edits")
    op.drop_table("calendar_event_edits")
    op.drop_index("ix_calendar_events_date", table_name="calendar_events")
    op.drop_table("calendar_events")
