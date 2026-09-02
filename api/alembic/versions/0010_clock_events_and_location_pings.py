"""Add clock_events (worker clock-in/out) and location_pings (GPS while on shift) tables.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-01

"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clock_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("clock_in_at", sa.DateTime(), nullable=False),
        sa.Column("clock_in_lat", sa.Float()),
        sa.Column("clock_in_lng", sa.Float()),
        sa.Column("clock_out_at", sa.DateTime()),
        sa.Column("clock_out_lat", sa.Float()),
        sa.Column("clock_out_lng", sa.Float()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_clock_events_user", "clock_events", ["user_id"])

    op.create_table(
        "location_pings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("clock_event_id", sa.Integer(), sa.ForeignKey("clock_events.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_location_pings_clock_event", "location_pings", ["clock_event_id"])


def downgrade() -> None:
    op.drop_index("ix_location_pings_clock_event", table_name="location_pings")
    op.drop_table("location_pings")
    op.drop_index("ix_clock_events_user", table_name="clock_events")
    op.drop_table("clock_events")
