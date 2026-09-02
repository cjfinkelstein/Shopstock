"""The transaction engine. Every stock change flows through apply_transaction():
one Transaction row + matching stock_levels update, flushed in the caller's DB
transaction so the ledger always reconciles to stock_levels.

Callers are responsible for the final commit; batch endpoints call this in a
loop and commit once, making the whole batch atomic.
"""

from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models import Item, Job, Location, StockLevel, Transaction, User, Vendor

QTY_EXP = Decimal("0.01")
COST_EXP = Decimal("0.0001")

TYPES = {"RECEIVE", "SIGN_OUT", "RETURN", "TRANSFER", "ADJUST"}
ADJUST_REASONS = {"count_correction", "damaged", "lost", "other"}


def _bad(msg: str) -> HTTPException:
    return HTTPException(status_code=400, detail=msg)


def validate_qty(item: Item, qty: Decimal) -> Decimal:
    """Rule 7: integers only for each/box; up to 2 decimals for foot."""
    qty = Decimal(str(qty))
    if qty <= 0:
        raise _bad("Quantity must be positive")
    if item.unit in ("each", "box"):
        if qty != qty.to_integral_value():
            raise _bad(f"{item.name} is sold by the {item.unit} — whole numbers only")
        return qty.quantize(QTY_EXP)
    # foot: up to 2 decimals
    if qty != qty.quantize(QTY_EXP, rounding=ROUND_HALF_UP):
        raise _bad("Footage supports at most 2 decimal places")
    return qty.quantize(QTY_EXP)


def _get_stock(db: Session, item_id: int, location_id: int, *, lock: bool = True) -> StockLevel:
    stmt = select(StockLevel).where(
        StockLevel.item_id == item_id, StockLevel.location_id == location_id
    )
    if lock and db.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update()
    row = db.scalars(stmt).first()
    if row is None:
        row = StockLevel(item_id=item_id, location_id=location_id, qty=Decimal("0"))
        db.add(row)
        db.flush()
    return row


def total_on_hand(db: Session, item_id: int) -> Decimal:
    total = db.scalar(
        select(func.coalesce(func.sum(StockLevel.qty), 0)).where(StockLevel.item_id == item_id)
    )
    return Decimal(str(total)).quantize(QTY_EXP)


def _require_location(db: Session, location_id: int) -> Location:
    loc = db.get(Location, location_id)
    if not loc or not loc.active:
        raise _bad(f"Location {location_id} not found")
    return loc


def apply_transaction(
    db: Session,
    *,
    type: str,
    item_id: int,
    qty: Decimal,
    user: User,
    from_location_id: int | None = None,
    to_location_id: int | None = None,
    job_id: int | None = None,
    vendor_id: int | None = None,
    unit_cost: Decimal | None = None,
    tax_amount: Decimal | None = None,
    ref: str | None = None,
    note: str | None = None,
    reason: str | None = None,
) -> Transaction:
    if type not in TYPES:
        raise _bad(f"Unknown transaction type {type}")

    item = db.get(Item, item_id)
    if not item or not item.active:
        raise _bad(f"Item {item_id} not found")
    qty = validate_qty(item, qty)

    # ---- Per-type validation (ledger rules 2-6) ----
    if type == "RECEIVE":
        if vendor_id is None or unit_cost is None:
            raise _bad("RECEIVE requires vendor and unit cost")
        vendor = db.get(Vendor, vendor_id)
        if not vendor or not vendor.active:
            raise _bad("Vendor not found")
        unit_cost = Decimal(str(unit_cost)).quantize(COST_EXP, rounding=ROUND_HALF_UP)
        if unit_cost < 0:
            raise _bad("Unit cost cannot be negative")
        if to_location_id is None:
            shop = db.scalars(select(Location).where(Location.type == "shop")).first()
            if not shop:
                raise _bad("No shop location exists")
            to_location_id = shop.id
        from_location_id = None
        job_id = None
    elif type == "SIGN_OUT":
        if job_id is None:
            raise _bad("Sign-out requires a job")
        if from_location_id is None:
            raise _bad("Sign-out requires a source location")
        to_location_id = None
        job = db.get(Job, job_id)
        if not job:
            raise _bad("Job not found")
        if job.status != "active":
            raise _bad(f"Job {job.job_number} is closed")
        vendor_id = None
        unit_cost = item.avg_cost  # rule 3: snapshot drives job costing
    elif type == "RETURN":
        if job_id is None:
            raise _bad("Return requires the job the material came from")
        if to_location_id is None:
            raise _bad("Return requires a destination location")
        from_location_id = None
        if not db.get(Job, job_id):
            raise _bad("Job not found")
        vendor_id = None
        unit_cost = item.avg_cost  # rule 4: costed at current avg snapshot
    elif type == "TRANSFER":
        if from_location_id is None or to_location_id is None:
            raise _bad("Transfer requires both locations")
        if from_location_id == to_location_id:
            raise _bad("Transfer source and destination must differ")
        job_id = None
        vendor_id = None
        unit_cost = item.avg_cost  # informational snapshot; no cost impact
    elif type == "ADJUST":
        if reason not in ADJUST_REASONS:
            raise _bad("Adjustment requires a valid reason")
        if not note or not note.strip():
            raise _bad("Adjustment requires a note")
        if (from_location_id is None) == (to_location_id is None):
            raise _bad("Adjustment must set exactly one of from/to location")
        job_id = None
        vendor_id = None
        unit_cost = item.avg_cost

    if from_location_id is not None:
        _require_location(db, from_location_id)
    if to_location_id is not None:
        _require_location(db, to_location_id)

    # ---- Availability check for take-out moves (sign-out / transfer) ----
    # Unlike ADJUST (which exists specifically to correct a wrong count) and
    # RETURN (which only ever adds stock), sign-out and transfer represent a
    # tech physically taking material from a location that's supposed to
    # have it — so if the ledger says there isn't enough there, block it
    # instead of letting it go negative.
    if type in ("SIGN_OUT", "TRANSFER") and from_location_id is not None:
        available = Decimal(str(_get_stock(db, item.id, from_location_id).qty))
        if qty > available:
            loc_name = _require_location(db, from_location_id).name
            raise _bad(
                f"Only {available} {item.unit} of {item.name} on hand at {loc_name} — can't take out {qty}"
            )

    # ---- Moving average (rule 2) — BEFORE stock moves ----
    if type == "RECEIVE":
        on_hand = total_on_hand(db, item.id)
        if on_hand <= 0:
            new_avg = unit_cost
        else:
            new_avg = ((on_hand * item.avg_cost + qty * unit_cost) / (on_hand + qty)).quantize(
                COST_EXP, rounding=ROUND_HALF_UP
            )
        item.avg_cost = new_avg
        item.last_cost = unit_cost

    # ---- Stock movement (rule 1: same DB transaction as the ledger row) ----
    went_negative = False
    if from_location_id is not None:
        src = _get_stock(db, item.id, from_location_id)
        src.qty = (Decimal(str(src.qty)) - qty).quantize(QTY_EXP)
        if src.qty < 0:
            went_negative = True  # rule 8: allow, flag, surface on dashboard
    if to_location_id is not None:
        dst = _get_stock(db, item.id, to_location_id)
        dst.qty = (Decimal(str(dst.qty)) + qty).quantize(QTY_EXP)

    txn = Transaction(
        type=type,
        item_id=item.id,
        qty=qty,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        job_id=job_id,
        user_id=user.id,
        vendor_id=vendor_id,
        unit_cost=unit_cost,
        tax_amount=tax_amount,
        ref=ref,
        note=note,
        reason=reason,
        went_negative=went_negative,
    )
    db.add(txn)
    db.flush()
    return txn
