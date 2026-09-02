from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Transaction, User
from app.schemas import (
    AdjustIn, ReceiveBatchIn, ReceiveIn, ReturnIn, SignOutBatchIn, SignOutIn,
    TransferBatchIn, TransferIn, TxnPage,
)
from app.services.dates import day_end_utc, day_start_utc
from app.services.ledger import apply_transaction
from app.services.serializers import serialize_txn

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.post("/receive", status_code=201)
def receive(body: ReceiveIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    txn = apply_transaction(
        db, type="RECEIVE", item_id=body.item_id, qty=body.qty, user=user,
        to_location_id=body.to_location_id, vendor_id=body.vendor_id,
        unit_cost=body.unit_cost, ref=body.ref, note=body.note,
    )
    db.commit()
    return serialize_txn(txn, user)


@router.post("/receive/batch", status_code=201)
def receive_batch(body: ReceiveBatchIn, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    """One PO with many lines — atomic: all lines land or none do."""
    if not body.lines:
        raise HTTPException(status_code=400, detail="No lines")
    txns = [
        apply_transaction(
            db, type="RECEIVE", item_id=line.item_id, qty=line.qty, user=user,
            to_location_id=body.to_location_id, vendor_id=body.vendor_id,
            unit_cost=line.unit_cost, ref=body.ref, note=line.note,
        )
        for line in body.lines
    ]
    db.commit()
    return [serialize_txn(t, user) for t in txns]


@router.post("/sign-out", status_code=201)
def sign_out(body: SignOutIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    txn = apply_transaction(
        db, type="SIGN_OUT", item_id=body.item_id, qty=body.qty, user=user,
        from_location_id=body.from_location_id, job_id=body.job_id, note=body.note,
    )
    db.commit()
    return serialize_txn(txn, user)


@router.post("/sign-out/batch", status_code=201)
def sign_out_batch(body: SignOutBatchIn, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """Cart checkout: many items, one job. Atomic."""
    if not body.lines:
        raise HTTPException(status_code=400, detail="Cart is empty")
    txns = []
    for line in body.lines:
        source = line.from_location_id or body.from_location_id
        if source is None:
            raise HTTPException(status_code=400, detail="Each line needs a source location")
        txns.append(apply_transaction(
            db, type="SIGN_OUT", item_id=line.item_id, qty=line.qty, user=user,
            from_location_id=source, job_id=body.job_id, note=body.note,
        ))
    db.commit()
    return [serialize_txn(t, user) for t in txns]


@router.post("/return", status_code=201)
def return_material(body: ReturnIn, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    txn = apply_transaction(
        db, type="RETURN", item_id=body.item_id, qty=body.qty, user=user,
        to_location_id=body.to_location_id, job_id=body.job_id, note=body.note,
    )
    db.commit()
    return serialize_txn(txn, user)


@router.post("/transfer", status_code=201)
def transfer(body: TransferIn, db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    txn = apply_transaction(
        db, type="TRANSFER", item_id=body.item_id, qty=body.qty, user=user,
        from_location_id=body.from_location_id, to_location_id=body.to_location_id,
        note=body.note,
    )
    db.commit()
    return serialize_txn(txn, user)


@router.post("/transfer/batch", status_code=201)
def transfer_batch(body: TransferBatchIn, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """Morning truck loading: whole cart shop -> truck. Atomic."""
    if not body.lines:
        raise HTTPException(status_code=400, detail="Cart is empty")
    txns = [
        apply_transaction(
            db, type="TRANSFER", item_id=line.item_id, qty=line.qty, user=user,
            from_location_id=body.from_location_id, to_location_id=body.to_location_id,
            note=body.note,
        )
        for line in body.lines
    ]
    db.commit()
    return [serialize_txn(t, user) for t in txns]


@router.post("/adjust", status_code=201)
def adjust(body: AdjustIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """Admin only. Signed effect via from/to: increase = to, decrease = from."""
    kwargs = {"to_location_id": body.location_id} if body.direction == "increase" \
        else {"from_location_id": body.location_id}
    txn = apply_transaction(
        db, type="ADJUST", item_id=body.item_id, qty=body.qty, user=user,
        reason=body.reason, note=body.note, **kwargs,
    )
    db.commit()
    return serialize_txn(txn, user)


@router.get("", response_model=TxnPage)
def list_transactions(
    type: str = "",
    item_id: int | None = None,
    job_id: int | None = None,
    user_id: int | None = None,
    location_id: int | None = None,
    date_from: str = "",
    date_to: str = "",
    mine: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Transaction)
    if type:
        q = q.filter(Transaction.type == type.upper())
    if item_id:
        q = q.filter(Transaction.item_id == item_id)
    if job_id:
        q = q.filter(Transaction.job_id == job_id)
    if user_id:
        q = q.filter(Transaction.user_id == user_id)
    if mine:
        q = q.filter(Transaction.user_id == user.id)
    if location_id:
        q = q.filter(or_(Transaction.from_location_id == location_id,
                         Transaction.to_location_id == location_id))
    if date_from:
        q = q.filter(Transaction.created_at >= day_start_utc(date_from))
    if date_to:
        q = q.filter(Transaction.created_at < day_end_utc(date_to))
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
