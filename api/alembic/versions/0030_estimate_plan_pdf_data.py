"""Add estimates.plan_pdf_data.

Splits plan upload from code-minimum symbol placement into two explicit
steps: uploading now only renders and stores the pages (fast), and a new
"Apply code-minimum symbols" button triggers the AI reading on demand. That
button needs the original PDF bytes to re-run the reading without asking
the admin to re-upload, so the uploaded PDF itself is now kept on the
estimate (same base64 data: URL convention as Item.image_data).

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-25

"""
from alembic import op
import sqlalchemy as sa

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("estimates") as batch_op:
        batch_op.add_column(sa.Column("plan_pdf_data", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("estimates") as batch_op:
        batch_op.drop_column("plan_pdf_data")
