from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Item, Location, StockLevel, Transaction, Truck, User
from app.services.dates import today_range_utc
from app.services.serializers import serialize_txn

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def recount_needed(db: Session) -> list[dict]:
    """Items flagged went_negative with no later count_correction ADJUST for the
    same item+location — these counts are suspect until someone recounts."""
    flagged = (
        db.query(Transaction)
        .options(joinedload(Transaction.item), joinedload(Transaction.from_location))
        .filter(Transaction.went_negative)
        .order_by(Transaction.created_at.desc())
        .all()
    )
    out: dict[tuple[int, int], dict] = {}
    for t in flagged:
        key = (t.item_id, t.from_location_id)
        if key in out:
            continue
        corrected = (
            db.query(Transaction)
            .filter(
                Transaction.type == "ADJUST",
                Transaction.reason == "count_correction",
                Transaction.item_id == t.item_id,
                ((Transaction.from_location_id == t.from_location_id)
                 | (Transaction.to_location_id == t.from_location_id)),
                Transaction.created_at >= t.created_at,
                Transaction.id > t.id,
            )
            .first()
        )
        if corrected:
            continue
        current = db.scalar(
            select(StockLevel.qty).where(StockLevel.item_id == t.item_id,
                                         StockLevel.location_id == t.from_location_id)
        )
        out[key] = {
            "item_id": t.item_id, "sku": t.item.sku, "item_name": t.item.name,
            "unit": t.item.unit, "item_image": t.item.image_data,
            "location_id": t.from_location_id,
            "location_name": t.from_location.name if t.from_location else "?",
            "current_qty": Decimal(str(current)) if current is not None else Decimal("0"),
            "flagged_at": t.created_at.isoformat() + "+00:00",
        }
    return list(out.values())


@router.get("/admin", dependencies=[Depends(require_admin)])
def admin_dashboard(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # low stock (shop qty <= reorder point)
    shop = db.scalars(select(Location).where(Location.type == "shop")).first()
    shop_qty: dict[int, Decimal] = {}
    if shop:
        for sl in db.query(StockLevel).filter(StockLevel.location_id == shop.id).all():
            shop_qty[sl.item_id] = Decimal(str(sl.qty))
    low = []
    for i in db.query(Item).filter(Item.active, Item.reorder_point > 0).all():
        qty = shop_qty.get(i.id, Decimal("0"))
        if qty <= i.reorder_point:
            low.append({"item_id": i.id, "sku": i.sku, "name": i.name, "unit": i.unit,
                        "image_data": i.image_data,
                        "shop_qty": qty, "reorder_point": i.reorder_point,
                        "suggested_qty": i.reorder_qty})
    low.sort(key=lambda r: r["name"])

    # today's activity (NY day)
    start, end = today_range_utc()
    todays = (
        db.query(Transaction)
        .options(joinedload(Transaction.item), joinedload(Transaction.job),
                 joinedload(Transaction.user), joinedload(Transaction.vendor),
                 joinedload(Transaction.from_location), joinedload(Transaction.to_location))
        .filter(Transaction.created_at >= start, Transaction.created_at < end)
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .all()
    )

    # inventory value
    value_total = Decimal("0")
    by_location: dict[int, dict] = {}
    rows = (
        db.query(StockLevel)
        .options(joinedload(StockLevel.item), joinedload(StockLevel.location))
        .join(Location, StockLevel.location_id == Location.id)
        .filter(Location.active)
        .all()
    )
    for r in rows:
        v = (Decimal(str(r.qty)) * Decimal(str(r.item.avg_cost))).quantize(Decimal("0.01"))
        loc = by_location.setdefault(r.location_id,
                                     {"location_id": r.location_id,
                                      "location_name": r.location.name, "value": Decimal("0")})
        loc["value"] += v
        value_total += v

    return {
        "low_stock_count": len(low),
        "low_stock": low,
        "recount_needed": recount_needed(db),
        "todays_signouts": [serialize_txn(t, user) for t in todays if t.type == "SIGN_OUT"],
        "todays_activity_count": len(todays),
        "inventory_value": {
            "total": value_total.quantize(Decimal("0.01")),
            "by_location": sorted(by_location.values(), key=lambda l: l["location_name"]),
        },
    }


@router.get("/tech")
def tech_dashboard(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    last10 = (
        db.query(Transaction)
        .options(joinedload(Transaction.item), joinedload(Transaction.job),
                 joinedload(Transaction.user), joinedload(Transaction.vendor),
                 joinedload(Transaction.from_location), joinedload(Transaction.to_location))
        .filter(Transaction.user_id == user.id)
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .limit(10)
        .all()
    )
    truck = db.query(Truck).filter(Truck.assigned_user_id == user.id, Truck.active).first()
    truck_summary = None
    if truck and truck.location:
        stock = (
            db.query(StockLevel)
            .options(joinedload(StockLevel.item))
            .filter(StockLevel.location_id == truck.location.id, StockLevel.qty != 0)
            .all()
        )
        truck_summary = {
            "truck_id": truck.id,
            "truck_name": truck.name,
            "location_id": truck.location.id,
            "item_count": len([s for s in stock if s.item.active]),
        }
    return {
        "my_transactions": [serialize_txn(t, user) for t in last10],
        "my_truck": truck_summary,
    }
