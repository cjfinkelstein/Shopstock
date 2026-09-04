from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import CalendarEvent, CalendarEventEdit, User
from app.schemas import CalendarEventCreate, CalendarEventEditOut, CalendarEventOut, CalendarEventUpdate

# Any logged-in user (tech or admin) can read/add/edit -- this is a shared
# team calendar, not an admin-only tool.
router = APIRouter(prefix="/calendar", tags=["calendar"], dependencies=[Depends(get_current_user)])


def _out(e: CalendarEvent) -> CalendarEventOut:
    return CalendarEventOut(
        id=e.id, event_date=e.event_date, title=e.title, notes=e.notes, done=e.done,
        created_by_name=e.creator.name if e.creator else None,
        created_at=e.created_at, updated_at=e.updated_at,
        edits=[
            CalendarEventEditOut(
                id=ed.id, field=ed.field, old_value=ed.old_value, new_value=ed.new_value,
                edited_by_name=ed.editor.name if ed.editor else None, created_at=ed.created_at,
            )
            for ed in e.edits
        ],
    )


@router.get("", response_model=list[CalendarEventOut])
def list_events(date_from: date | None = None, date_to: date | None = None, db: Session = Depends(get_db)):
    q = db.query(CalendarEvent).options(
        joinedload(CalendarEvent.creator),
        joinedload(CalendarEvent.edits).joinedload(CalendarEventEdit.editor),
    )
    if date_from:
        q = q.filter(CalendarEvent.event_date >= date_from)
    if date_to:
        q = q.filter(CalendarEvent.event_date <= date_to)
    rows = q.order_by(CalendarEvent.event_date, CalendarEvent.id).all()
    return [_out(e) for e in rows]


@router.post("", response_model=CalendarEventOut, status_code=201)
def create_event(body: CalendarEventCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    e = CalendarEvent(event_date=body.event_date, title=body.title, notes=body.notes, created_by=user.id)
    db.add(e)
    db.commit()
    db.refresh(e)
    return _out(e)


@router.patch("/{event_id}", response_model=CalendarEventOut)
def update_event(event_id: int, body: CalendarEventUpdate, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    e = db.get(CalendarEvent, event_id)
    if not e:
        raise HTTPException(status_code=404, detail="Not found")

    def record(field: str, old, new) -> None:
        db.add(CalendarEventEdit(
            event_id=e.id, edited_by=user.id, field=field,
            old_value=str(old) if old is not None else None,
            new_value=str(new) if new is not None else None,
        ))

    if body.title is not None and body.title != e.title:
        record("title", e.title, body.title)
        e.title = body.title
    if body.event_date is not None and body.event_date != e.event_date:
        record("event_date", e.event_date, body.event_date)
        e.event_date = body.event_date
    if body.notes is not None and body.notes != e.notes:
        record("notes", e.notes, body.notes)
        e.notes = body.notes
    if body.done is not None and body.done != e.done:
        record("done", e.done, body.done)
        e.done = body.done
    db.commit()
    db.refresh(e)
    return _out(e)
