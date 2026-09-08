from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin
from app.models import PtoEntry, User
from app.database import get_db
from app.schemas import PtoBalanceOut, PtoEntryCreate, PtoEntryOut, PtoRequestIn

# Per the employee handbook: 15 vacation days + 5 personal days per calendar
# year, resetting every January 1st -- unused days do not carry over.
VACATION_DAYS_PER_YEAR = Decimal("15")
PERSONAL_DAYS_PER_YEAR = Decimal("5")

router = APIRouter(prefix="/pto", tags=["pto"], dependencies=[Depends(get_current_user)])


def _business_days(start: date, end: date) -> int:
    """Weekday (Mon-Fri) count in an inclusive date range -- matches the
    handbook's "business days" framing for both vacation and personal time."""
    count = 0
    d = start
    while d <= end:
        if d.weekday() < 5:
            count += 1
        d += timedelta(days=1)
    return count


def _entry_out(e: PtoEntry) -> PtoEntryOut:
    return PtoEntryOut(
        id=e.id, user_id=e.user_id, user_name=e.user.name, entry_date=e.entry_date,
        end_date=e.end_date, category=e.category, days=e.days, status=e.status, notes=e.notes,
        created_by_name=e.creator.name if e.creator else None,
        decided_by_name=e.decider.name if e.decider else None, decided_at=e.decided_at,
        created_at=e.created_at, updated_at=e.updated_at,
    )


def _balance_for(db: Session, user: User, year: int) -> PtoBalanceOut:
    entries = (
        db.query(PtoEntry)
        .options(joinedload(PtoEntry.user), joinedload(PtoEntry.creator), joinedload(PtoEntry.decider))
        .filter(
            PtoEntry.user_id == user.id,
            PtoEntry.entry_date >= date(year, 1, 1),
            PtoEntry.entry_date <= date(year, 12, 31),
        )
        .order_by(PtoEntry.entry_date.desc())
        .all()
    )
    vacation_used = sum((e.days for e in entries if e.category == "vacation" and e.status == "approved"), Decimal("0"))
    personal_used = sum((e.days for e in entries if e.category == "personal" and e.status == "approved"), Decimal("0"))
    vacation_pending = sum((e.days for e in entries if e.category == "vacation" and e.status == "pending"), Decimal("0"))
    personal_pending = sum((e.days for e in entries if e.category == "personal" and e.status == "pending"), Decimal("0"))
    return PtoBalanceOut(
        user_id=user.id, user_name=user.name, year=year,
        vacation_allotted=VACATION_DAYS_PER_YEAR, vacation_used=vacation_used,
        vacation_remaining=VACATION_DAYS_PER_YEAR - vacation_used, vacation_pending=vacation_pending,
        personal_allotted=PERSONAL_DAYS_PER_YEAR, personal_used=personal_used,
        personal_remaining=PERSONAL_DAYS_PER_YEAR - personal_used, personal_pending=personal_pending,
        entries=[_entry_out(e) for e in entries],
    )


@router.get("/balance", response_model=PtoBalanceOut)
def my_balance(year: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A tech's own balance -- any logged-in user can see their own."""
    return _balance_for(db, user, year or datetime.utcnow().year)


@router.get("", response_model=list[PtoBalanceOut])
def all_balances(year: int | None = None, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Every tech's balance, for the admin PTO management view."""
    y = year or datetime.utcnow().year
    techs = db.query(User).filter(User.role == "tech", User.active).order_by(User.name).all()
    return [_balance_for(db, t, y) for t in techs]


@router.get("/pending", response_model=list[PtoEntryOut])
def pending_requests(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Every tech's pending self-requested time off, across everyone --
    the admin review queue."""
    rows = (
        db.query(PtoEntry)
        .options(joinedload(PtoEntry.user), joinedload(PtoEntry.creator))
        .filter(PtoEntry.status == "pending")
        .order_by(PtoEntry.entry_date)
        .all()
    )
    return [_entry_out(e) for e in rows]


@router.post("/request", response_model=PtoEntryOut, status_code=201)
def request_pto(body: PtoRequestIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A tech requests their own time off -- sits as pending until an admin
    approves or denies it, and doesn't count against their balance until
    then."""
    if user.role != "tech":
        raise HTTPException(status_code=400, detail="Only techs can request PTO")
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="End date must be on or after the start date")
    days = _business_days(body.start_date, body.end_date)
    if days <= 0:
        raise HTTPException(status_code=400, detail="That range doesn't include any weekdays")
    e = PtoEntry(
        user_id=user.id, entry_date=body.start_date, end_date=body.end_date, category=body.category,
        days=Decimal(days), status="pending", notes=body.notes, created_by=user.id,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _entry_out(e)


@router.post("", response_model=PtoBalanceOut, status_code=201)
def log_pto(body: PtoEntryCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """An admin logging a day directly -- auto-approved, nothing to confirm."""
    user = db.get(User, body.user_id)
    if not user or user.role != "tech":
        raise HTTPException(status_code=404, detail="Tech not found")
    e = PtoEntry(
        user_id=user.id, entry_date=body.entry_date, category=body.category,
        days=body.days, notes=body.notes, created_by=admin.id, status="approved",
        decided_by=admin.id, decided_at=datetime.utcnow(),
    )
    db.add(e)
    db.commit()
    return _balance_for(db, user, body.entry_date.year)


@router.post("/{entry_id}/approve", response_model=PtoEntryOut)
def approve_pto(entry_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    e = db.get(PtoEntry, entry_id)
    if not e:
        raise HTTPException(status_code=404, detail="Not found")
    e.status = "approved"
    e.decided_by = admin.id
    e.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(e)
    return _entry_out(e)


@router.post("/{entry_id}/deny", response_model=PtoEntryOut)
def deny_pto(entry_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    e = db.get(PtoEntry, entry_id)
    if not e:
        raise HTTPException(status_code=404, detail="Not found")
    e.status = "denied"
    e.decided_by = admin.id
    e.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(e)
    return _entry_out(e)


@router.delete("/{entry_id}", status_code=204)
def delete_pto(entry_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    e = db.get(PtoEntry, entry_id)
    if e:
        db.delete(e)
        db.commit()
