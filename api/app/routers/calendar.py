from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import CalendarEvent, CalendarEventEdit, User
from app.schemas import CalendarEventCreate, CalendarEventEditOut, CalendarEventOut, CalendarEventUpdate

# Any logged-in user (tech or admin) can read, add, and generally edit --
# this is the shared team calendar, not an admin-only tool. Every query
# here is scoped to visibility="shared" so a tech can never see or touch an
# admin's private note, even by guessing an id. Two carved-out exceptions,
# both Ray/admin only -- see _is_ray/_protected below: (1) assigning a task
# to another tech (create_event rejects a non-Ray/admin's assignee), and
# (2) editing or deleting Ray's own entries. Everyone else's entries,
# including each other's, stay fully open.
router = APIRouter(prefix="/calendar", tags=["calendar"], dependencies=[Depends(get_current_user)])

# An admin's own private notes/to-dos on the Login Hours page -- never
# returned to a tech. Separate prefix, separate admin-only gate.
admin_router = APIRouter(prefix="/calendar/admin", tags=["calendar"], dependencies=[Depends(require_admin)])

# Matched on first name since Ray's account is actually stored as the full
# "Raymond Bailey" (confirmed from the live site).
_RAY_FIRST_NAMES = {"ray", "raymond"}


def _first_name(name: str | None) -> str:
    return name.strip().split(" ", 1)[0].lower() if name else ""


def _is_ray(user: User) -> bool:
    return _first_name(user.name) in _RAY_FIRST_NAMES


def _protected(e: CalendarEvent, user: User) -> bool:
    """True if this entry is Ray's own and the current user is neither Ray
    nor an admin -- i.e. they may not edit or delete it."""
    if user.role == "admin" or _is_ray(user):
        return False
    return _first_name(e.creator.name if e.creator else None) in _RAY_FIRST_NAMES


def _out(e: CalendarEvent) -> CalendarEventOut:
    return CalendarEventOut(
        id=e.id, event_date=e.event_date, title=e.title, notes=e.notes, done=e.done,
        assignee=e.assignee,
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
    q = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.visibility == "shared")
        .options(
            joinedload(CalendarEvent.creator),
            joinedload(CalendarEvent.edits).joinedload(CalendarEventEdit.editor),
        )
    )
    if date_from:
        q = q.filter(CalendarEvent.event_date >= date_from)
    if date_to:
        q = q.filter(CalendarEvent.event_date <= date_to)
    rows = q.order_by(CalendarEvent.event_date, CalendarEvent.id).all()
    return [_out(e) for e in rows]


@router.post("", response_model=CalendarEventOut, status_code=201)
def create_event(body: CalendarEventCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Assigning a task to another tech is Ray/admin only; a plain,
    # unassigned to-do stays open to everyone.
    if body.assignee and user.role != "admin" and not _is_ray(user):
        raise HTTPException(status_code=403, detail="Only Ray or an admin can assign a task")
    e = CalendarEvent(
        event_date=body.event_date, title=body.title, notes=body.notes, created_by=user.id, visibility="shared",
        assignee=body.assignee,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _out(e)


@router.patch("/{event_id}", response_model=CalendarEventOut)
def update_event(event_id: int, body: CalendarEventUpdate, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    e = db.get(CalendarEvent, event_id)
    if not e or e.visibility != "shared":
        raise HTTPException(status_code=404, detail="Not found")
    if _protected(e, user):
        raise HTTPException(status_code=403, detail="Only Ray or an admin can edit this")

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


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    e = db.get(CalendarEvent, event_id)
    if not e or e.visibility != "shared":
        raise HTTPException(status_code=404, detail="Not found")
    if _protected(e, user):
        raise HTTPException(status_code=403, detail="Only Ray or an admin can delete this")
    db.delete(e)
    db.commit()


@admin_router.get("", response_model=list[CalendarEventOut])
def list_admin_notes(date_from: date | None = None, date_to: date | None = None, db: Session = Depends(get_db)):
    q = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.visibility == "admin_only")
        .options(joinedload(CalendarEvent.creator))
    )
    if date_from:
        q = q.filter(CalendarEvent.event_date >= date_from)
    if date_to:
        q = q.filter(CalendarEvent.event_date <= date_to)
    rows = q.order_by(CalendarEvent.event_date, CalendarEvent.id).all()
    return [_out(e) for e in rows]


@admin_router.post("", response_model=CalendarEventOut, status_code=201)
def create_admin_note(body: CalendarEventCreate, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    e = CalendarEvent(
        event_date=body.event_date, title=body.title, notes=body.notes, created_by=user.id,
        visibility="admin_only",
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _out(e)


@admin_router.patch("/{event_id}", response_model=CalendarEventOut)
def update_admin_note(event_id: int, body: CalendarEventUpdate, db: Session = Depends(get_db)):
    e = db.get(CalendarEvent, event_id)
    if not e or e.visibility != "admin_only":
        raise HTTPException(status_code=404, detail="Not found")
    if body.title is not None:
        e.title = body.title
    if body.event_date is not None:
        e.event_date = body.event_date
    if body.notes is not None:
        e.notes = body.notes
    if body.done is not None:
        e.done = body.done
    db.commit()
    db.refresh(e)
    return _out(e)


@admin_router.delete("/{event_id}", status_code=204)
def delete_admin_note(event_id: int, db: Session = Depends(get_db)):
    e = db.get(CalendarEvent, event_id)
    if e and e.visibility == "admin_only":
        db.delete(e)
        db.commit()
