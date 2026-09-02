from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Location, StockLevel, User
from app.schemas import StockRow, ValuationOut, ValuationRow

router = APIRouter(prefix="/stock", tags=["stock"])


@router.get("", response_model=list[StockRow])
def get_stock(location_id: int | None = None, include_zero: bool = False,
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = (
        db.query(StockLevel)
        .options(joinedload(StockLevel.item), joinedload(StockLevel.location))
        .join(Location, StockLevel.location_id == Location.id)
        .filter(Location.active)
    )
    if location_id:
        q = q.filter(StockLevel.location_id == location_id)
    rows = q.all()
    out = []
    for r in rows:
        if not r.item.active:
            continue
        if not include_zero and r.qty == 0:
            continue
        out.append(StockRow(
            item_id=r.item_id, sku=r.item.sku, name=r.item.name,
            category=r.item.category, unit=r.item.unit, image_data=r.item.image_data,
            location_id=r.location_id, location_name=r.location.name, qty=r.qty,
        ))
    out.sort(key=lambda r: (r.location_name, r.category, r.name))
    return out


@router.get("/valuation", response_model=ValuationOut, dependencies=[Depends(require_admin)])
def valuation(db: Session = Depends(get_db)):
    """qty x avg_cost by location. Admin only — this is all cost data."""
    rows = (
        db.query(StockLevel)
        .options(joinedload(StockLevel.item), joinedload(StockLevel.location))
        .join(Location, StockLevel.location_id == Location.id)
        .filter(Location.active)
        .all()
    )
    by_loc: dict[int, ValuationRow] = {}
    total = Decimal("0")
    for r in rows:
        value = (Decimal(str(r.qty)) * Decimal(str(r.item.avg_cost))).quantize(Decimal("0.01"))
        row = by_loc.setdefault(r.location_id, ValuationRow(
            location_id=r.location_id, location_name=r.location.name, value=Decimal("0")))
        row.value += value
        total += value
    out = sorted(by_loc.values(), key=lambda v: v.location_name)
    return ValuationOut(by_location=out, total=total.quantize(Decimal("0.01")))
