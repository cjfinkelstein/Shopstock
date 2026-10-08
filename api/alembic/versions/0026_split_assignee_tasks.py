"""Split blob-style assignee calendar_events into one row per task.

The per-person Calendar assignment feature originally stored one
calendar_events row per (date, assignee), with notes as a newline-
separated blob of task lines and no per-line completion. Now that a
tech can check off their own tasks (which needs a real done flag per
task, not a shared blob), each line needs to be its own row:
title=<the task text>, assignee=<same person>, done=False.

This is a pure data migration (no schema change -- assignee/title/
notes/done all already exist from 0025). Any row with assignee set is
split: one new row per non-blank line in its notes, same event_date
and assignee, then the original blob row is deleted. A row whose notes
were empty (shouldn't happen given the app's own validation, but
defensive) is just dropped, since there's no task text to carry over.

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

calendar_events = sa.table(
    "calendar_events",
    sa.column("id", sa.Integer),
    sa.column("event_date", sa.Date),
    sa.column("title", sa.String),
    sa.column("notes", sa.Text),
    sa.column("done", sa.Boolean),
    sa.column("created_by", sa.Integer),
    sa.column("visibility", sa.String),
    sa.column("assignee", sa.String),
    sa.column("created_at", sa.DateTime),
    sa.column("updated_at", sa.DateTime),
)

calendar_event_edits = sa.table(
    "calendar_event_edits",
    sa.column("id", sa.Integer),
    sa.column("event_id", sa.Integer),
)


def _delete_event(conn, event_id) -> None:
    # A row being replaced here may have edit-history rows pointing at it
    # (calendar_event_edits.event_id is a foreign key) -- deleting the
    # parent first violates that constraint. The old blob row's edit
    # history doesn't map onto the new per-task rows anyway (it was about
    # the whole list, not one task), so it's dropped along with the row,
    # same lossiness already accepted for downgrade's done-state.
    conn.execute(calendar_event_edits.delete().where(calendar_event_edits.c.event_id == event_id))
    conn.execute(calendar_events.delete().where(calendar_events.c.id == event_id))


def upgrade() -> None:
    conn = op.get_bind()
    now = sa.func.now()
    rows = conn.execute(
        sa.select(calendar_events).where(calendar_events.c.assignee.isnot(None))
    ).fetchall()
    for row in rows:
        lines = [line.strip() for line in (row.notes or "").split("\n") if line.strip()]
        for line in lines:
            conn.execute(
                calendar_events.insert().values(
                    event_date=row.event_date, title=line, notes=None, done=False,
                    created_by=row.created_by, visibility=row.visibility, assignee=row.assignee,
                    created_at=row.created_at or now, updated_at=now,
                )
            )
        _delete_event(conn, row.id)


def downgrade() -> None:
    # Best-effort: for each assignee+date group, fold all task rows back
    # into a single row (title=assignee, notes=task lines joined), keeping
    # the earliest row's id/metadata and deleting the rest. Lossy for any
    # per-task done state, which this older shape had no field for anyway.
    conn = op.get_bind()
    rows = conn.execute(
        sa.select(calendar_events)
        .where(calendar_events.c.assignee.isnot(None))
        .order_by(calendar_events.c.event_date, calendar_events.c.assignee, calendar_events.c.id)
    ).fetchall()
    groups: dict[tuple, list] = {}
    for row in rows:
        groups.setdefault((row.event_date, row.assignee), []).append(row)
    for (event_date, assignee), group_rows in groups.items():
        keeper = group_rows[0]
        combined = "\n".join(r.title for r in group_rows)
        conn.execute(
            calendar_events.update()
            .where(calendar_events.c.id == keeper.id)
            .values(title=assignee, notes=combined, done=False)
        )
        for r in group_rows[1:]:
            _delete_event(conn, r.id)
