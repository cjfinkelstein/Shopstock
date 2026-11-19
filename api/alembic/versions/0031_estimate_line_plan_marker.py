"""Add estimate_lines.from_plan and plan_marker_id.

Lets "Apply to estimate" on the plan markup screen be re-run safely: lines
it previously created are tagged from_plan=true, so a re-apply can find
and replace exactly those lines (even if the marker that produced one was
since deleted/replaced, e.g. by re-running auto-layout) without touching
lines added by hand. plan_marker_id is a best-effort trace back to the
originating marker, SET NULL on delete since it's not what re-apply
matches on.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-19

"""
from alembic import op
import sqlalchemy as sa

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("estimate_lines") as batch_op:
        batch_op.add_column(sa.Column("from_plan", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("plan_marker_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_estimate_lines_plan_marker_id", "estimate_plan_markers", ["plan_marker_id"], ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_estimate_lines_plan_marker_id", "estimate_lines", ["plan_marker_id"])


def downgrade() -> None:
    op.drop_index("ix_estimate_lines_plan_marker_id", table_name="estimate_lines")
    with op.batch_alter_table("estimate_lines") as batch_op:
        batch_op.drop_constraint("fk_estimate_lines_plan_marker_id", type_="foreignkey")
        batch_op.drop_column("plan_marker_id")
        batch_op.drop_column("from_plan")
