from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Item, Location, StockLevel, Transaction, User, Vendor
from app.schemas import ItemCreate, ItemStockOut, ItemStockRow, ItemUpdate, TxnPage
from app.services.serializers import serialize_item, serialize_txn

router = APIRouter(prefix="/items", tags=["items"])


@router.get("")
def list_items(
    search: str = "",
    category: str = "",
    vendor_id: int | None = None,
    low_stock: bool = False,
    in_stock: bool = False,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Item)
    if not include_inactive:
        q = q.filter(Item.active)
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(Item.name.ilike(like), Item.sku.ilike(like), Item.barcode.ilike(like),
                         Item.description.ilike(like)))
    if category:
        q = q.filter(Item.category == category)
    if vendor_id is not None:
        received_ids = {
            row[0] for row in db.query(Transaction.item_id)
            .filter(Transaction.type == "RECEIVE", Transaction.vendor_id == vendor_id)
            .distinct()
        }
        q = q.filter(Item.id.in_(received_ids))
    items = q.order_by(Item.category, Item.name).all()

    if low_stock:
        # shop qty <= reorder_point (admin concern, but harmless for techs)
        shop = db.scalars(select(Location).where(Location.type == "shop")).first()
        shop_qty: dict[int, Decimal] = {}
        if shop:
            for sl in db.query(StockLevel).filter(StockLevel.location_id == shop.id).all():
                shop_qty[sl.item_id] = sl.qty
        items = [i for i in items if i.reorder_point > 0
                 and shop_qty.get(i.id, Decimal("0")) <= i.reorder_point]

    if in_stock and items:
        item_ids = [i.id for i in items]
        on_hand_totals: dict[int, Decimal] = {
            iid: Decimal(str(total or 0))
            for iid, total in db.query(StockLevel.item_id, func.sum(StockLevel.qty))
            .filter(StockLevel.item_id.in_(item_ids))
            .group_by(StockLevel.item_id)
            .all()
        }
        items = [i for i in items if on_hand_totals.get(i.id, Decimal("0")) > 0]

    if user.role != "admin" or not items:
        return [serialize_item(i, user) for i in items]

    # Admin list gets vendor + stock-usage context: who supplied it, how much
    # is on hand right now, and how much has already left inventory.
    item_ids = [i.id for i in items]

    vendors_by_item: dict[int, list[str]] = {}
    for iid, vname in (
        db.query(Transaction.item_id, Vendor.name)
        .join(Vendor, Transaction.vendor_id == Vendor.id)
        .filter(Transaction.type == "RECEIVE", Transaction.item_id.in_(item_ids))
        .distinct()
        .all()
    ):
        vendors_by_item.setdefault(iid, []).append(vname)

    on_hand_by_item: dict[int, Decimal] = {
        iid: Decimal(str(total or 0))
        for iid, total in db.query(StockLevel.item_id, func.sum(StockLevel.qty))
        .filter(StockLevel.item_id.in_(item_ids))
        .group_by(StockLevel.item_id)
        .all()
    }
    received_by_item: dict[int, Decimal] = {
        iid: Decimal(str(total or 0))
        for iid, total in db.query(Transaction.item_id, func.sum(Transaction.qty))
        .filter(Transaction.type == "RECEIVE", Transaction.item_id.in_(item_ids))
        .group_by(Transaction.item_id)
        .all()
    }

    spent_and_dates: dict[int, tuple[Decimal, list]] = {}
    for iid, qty, unit_cost, created_at in (
        db.query(Transaction.item_id, Transaction.qty, Transaction.unit_cost, Transaction.created_at)
        .filter(Transaction.type == "RECEIVE", Transaction.item_id.in_(item_ids))
        .all()
    ):
        cost, dates = spent_and_dates.setdefault(iid, (Decimal("0"), []))
        cost += Decimal(str(qty)) * Decimal(str(unit_cost or 0))
        dates.append(created_at.date())
        spent_and_dates[iid] = (cost, dates)

    out = []
    for i in items:
        base = serialize_item(i, user)
        on_hand = on_hand_by_item.get(i.id, Decimal("0"))
        received = received_by_item.get(i.id, Decimal("0"))
        used = received - on_hand
        spent, dates = spent_and_dates.get(i.id, (Decimal("0"), []))
        out.append(base.model_copy(update={
            "vendors": sorted(vendors_by_item.get(i.id, [])),
            "on_hand": on_hand,
            "received": received,
            "used": used if used > 0 else Decimal("0"),
            "total_spent": spent.quantize(Decimal("0.01")),
            "dates_bought": sorted({d.isoformat() for d in dates}),
        }))
    return out


@router.get("/categories", response_model=list[str])
def list_categories(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.execute(select(Item.category).where(Item.active).distinct().order_by(Item.category)).all()
    return [r[0] for r in rows]


@router.get("/by-barcode/{code}")
def by_barcode(code: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = db.query(Item).filter(Item.barcode == code, Item.active).first()
    if not item:
        item = db.query(Item).filter(Item.sku == code, Item.active).first()
    if not item:
        raise HTTPException(status_code=404, detail="No item matches that code")
    return serialize_item(item, user)


@router.get("/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return serialize_item(item, user)


@router.get("/{item_id}/stock", response_model=ItemStockOut)
def item_stock(item_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    rows = (
        db.query(StockLevel)
        .options(joinedload(StockLevel.location))
        .filter(StockLevel.item_id == item_id)
        .join(Location)
        .filter(Location.active)
        .order_by(Location.type.desc(), Location.name)
        .all()
    )
    locations = [
        ItemStockRow(location_id=r.location_id, location_name=r.location.name,
                     location_type=r.location.type, qty=r.qty)
        for r in rows
    ]
    total = sum((r.qty for r in rows), Decimal("0"))
    return ItemStockOut(item_id=item_id, total=total, locations=locations)


@router.get("/{item_id}/history", response_model=TxnPage)
def item_history(
    item_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Transaction).filter(Transaction.item_id == item_id)
    total = q.count()
    txns = (
        q.options(joinedload(Transaction.item), joinedload(Transaction.job),
                  joinedload(Transaction.user), joinedload(Transaction.vendor),
                  joinedload(Transaction.from_location), joinedload(Transaction.to_location))
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return TxnPage(total=total, page=page, page_size=page_size,
                   items=[serialize_txn(t, user) for t in txns])


@router.post("", status_code=201, dependencies=[Depends(require_admin)])
def create_item(body: ItemCreate, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    if db.query(Item).filter(Item.sku == body.sku.strip()).first():
        raise HTTPException(status_code=400, detail=f"SKU {body.sku} already exists")
    item = Item(
        sku=body.sku.strip(),
        barcode=(body.barcode or body.sku).strip(),
        name=body.name.strip(),
        description=body.description,
        image_data=body.image_data,
        category=body.category.strip(),
        unit=body.unit,
        reorder_point=body.reorder_point,
        reorder_qty=body.reorder_qty,
        notes=body.notes,
        active=True,
    )
    db.add(item)
    db.commit()
    return serialize_item(item, user)


@router.patch("/{item_id}", dependencies=[Depends(require_admin)])
def update_item(item_id: int, body: ItemUpdate, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    data = body.model_dump(exclude_unset=True)
    if "sku" in data:
        dupe = db.query(Item).filter(Item.sku == data["sku"].strip(), Item.id != item_id).first()
        if dupe:
            raise HTTPException(status_code=400, detail="SKU already exists")
        data["sku"] = data["sku"].strip()
    for field, value in data.items():
        setattr(item, field, value)
    db.commit()
    return serialize_item(item, user)
