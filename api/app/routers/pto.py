from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import PtoEntry, User
from app.schemas import PtoBalanceOut, PtoEntryCreate, PtoEntryOut

# Per the employee handbook: 15 vacation days + 5 personal days per calendar
# year, resetting every January 1st -- unused days do not carry over.
VACATION_DAYS_PER_YEAR = Decimal("15")
PERSONAL_DAYS_PER_YEAR = Decimal("5")

router = APIRouter(prefix="/pto", tags=["pto"], dependencies=[Depends(get_current_user)])


def _entry_out(e: PtoEntry) -> PtoEntryOut:
    return PtoEntryOut(
        id=e.id, user_id=e.user_id, user_name=e.user.name, entry_date=e.entry_date,
        category=e.category, days=e.days, notes=e.notes,
        created_by_name=e.creator.name if e.creator else None,
        created_at=e.created_at, updated_at=e.updated_at,
    )


def _balance_for(db: Session, user: User, year: int) -> PtoBalanceOut:
    entries = (
        db.query(PtoEntry)
        .options(joinedload(PtoEntry.user), joinedload(PtoEntry.creator))
        .filter(
            PtoEntry.user_id == user.id,
            PtoEntry.entry_date >= date(year, 1, 1),
            PtoEntry.entry_date <= date(year, 12, 31),
        )
        .order_by(PtoEntry.entry_date.desc())
        .all()
    )
    vacation_used = sum((e.days for e in entries if e.category == "vacation"), Decimal("0"))
    personal_used = sum((e.days for e in entries if e.category == "personal"), Decimal("0"))
    return PtoBalanceOut(
        user_id=user.id, user_name=user.name, year=year,
        vacation_allotted=VACATION_DAYS_PER_YEAR, vacation_used=vacation_used,
        vacation_remaining=VACATION_DAYS_PER_YEAR - vacation_used,
        personal_allotted=PERSONAL_DAYS_PER_YEAR, personal_used=personal_used,
        personal_remaining=PERSONAL_DAYS_PER_YEAR - personal_used,
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


@router.post("", response_model=PtoBalanceOut, status_code=201)
def log_pto(body: PtoEntryCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.get(User, body.user_id)
    if not user or user.role != "tech":
        raise HTTPException(status_code=404, detail="Tech not found")
    e = PtoEntry(
        user_id=user.id, entry_date=body.entry_date, category=body.category,
        days=body.days, notes=body.notes, created_by=admin.id,
    )
    db.add(e)
    db.commit()
    return _balance_for(db, user, body.entry_date.year)


@router.delete("/{entry_id}", status_code=204)
def delete_pto(entry_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    e = db.get(PtoEntry, entry_id)
    if e:
        db.delete(e)
        db.commit()
