"""Add job_files table (documents/photos per job) and link estimates to jobs.

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-17

"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("jobs.id"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("data", sa.Text(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_job_files_job", "job_files", ["job_id"])

    # batch mode: SQLite (local dev) can't ALTER a table to add a column with
    # a foreign-key constraint directly -- batch mode does a copy-and-move
    # under the hood there, while on Postgres (prod) it's just a plain ALTER.
    with op.batch_alter_table("estimates") as batch_op:
        batch_op.add_column(sa.Column("job_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_estimates_job_id", "jobs", ["job_id"], ["id"])
    op.create_index("ix_estimates_job", "estimates", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_estimates_job", table_name="estimates")
    with op.batch_alter_table("estimates") as batch_op:
        batch_op.drop_constraint("fk_estimates_job_id", type_="foreignkey")
        batch_op.drop_column("job_id")
    op.drop_index("ix_job_files_job", table_name="job_files")
    op.drop_table("job_files")
