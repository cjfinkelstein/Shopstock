"""Create the "1407 Shoemaker" job (the one PO reference from the Maurice
invoices that didn't match any of the 19 given projects) and sign out the
3 remaining unattributed items to it, same pattern as attach_jobs_20260728.py.

Run from the api/ directory:  python scripts/attach_shoemaker_job_20260728.py
"""

import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Item, Job, Location, Transaction, User
from app.services.ledger import apply_transaction

# (sku, qty, date, ref, note)
SHOEMAKER_SIGNOUTS = [
    ("WIRE-SEU666", "40", "2026-07-28", "S130916367.001", "PO: 1407 SHOEMAKER"),
    ("FITT-SC1SEC", "2", "2026-07-28", "S130916367.001", "PO: 1407 SHOEMAKER"),
    ("DISC-DPU222R", "2", "2026-07-28", "S130916367.002", "PO: 1407 SHOEMAKER"),
]


def dt(date_str: str) -> datetime:
    return datetime.strptime(date_str, "%Y-%m-%d").replace(hour=14)


def main() -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").first()
        shop = db.query(Location).filter(Location.type == "shop").first()

        job = db.query(Job).filter(Job.job_number == "JOB-1023").first()
        if not job:
            job = Job(job_number="JOB-1023", name="1407 Shoemaker", status="active")
            db.add(job)
            db.commit()
            print("Created JOB-1023: 1407 Shoemaker")

        # Delete the superseded zero-out ADJUST rows for these 3 items
        zero_outs = db.query(Transaction).filter(
            Transaction.type == "ADJUST", Transaction.note.like("%bulk%")
        ).all()
        deleted = 0
        for t in zero_outs:
            if t.item.sku in {sku for sku, *_ in SHOEMAKER_SIGNOUTS}:
                db.delete(t)
                deleted += 1
        db.commit()
        print(f"Deleted {deleted} superseded zero-out ADJUST rows")

        for sku, qty, date_str, ref, note in SHOEMAKER_SIGNOUTS:
            item = db.query(Item).filter(Item.sku == sku).first()
            txn = apply_transaction(
                db, type="SIGN_OUT", item_id=item.id, qty=qty, user=admin,
                from_location_id=shop.id, job_id=job.id, ref=ref, note=note,
            )
            when = dt(date_str)
            txn.created_at = when
            txn.updated_at = when
        db.commit()
        print(f"Signed out {len(SHOEMAKER_SIGNOUTS)} lines to 1407 Shoemaker")

        # Deleting the old ADJUST rows doesn't reverse their stock_levels
        # side-effect (learned this the hard way last time) -- fix directly.
        from app.models import StockLevel
        neg = db.query(StockLevel).filter(StockLevel.qty < 0).all()
        for row in neg:
            print(f"Correcting stock_levels: {row.item.sku} {row.qty} -> 0")
            row.qty = Decimal("0")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
