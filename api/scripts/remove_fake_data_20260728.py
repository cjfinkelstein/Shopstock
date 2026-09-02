"""Second cleanup pass: remove everything still fictional after the first
demo-item purge.

- 3 demo jobs (JOB-1001/1002/1003) -- fake customers/addresses, zero real
  transactions attached.
- 6 items (COND-EMT34, STRAP-EMT34, DEV-GFCI20, PLATE-1G-DUP, WIRE-12THHN-BK,
  WIRE-12THHN-WH) that are real (matched real Maurice purchases) but still
  carried their original fake "City Electric Supply / OPENING" seed stock,
  plus 2 fake truck-transfer transactions derived from it. Rebuilt from
  scratch using only the real transactions (same data as
  import_maurice_20260728.py, filtered to these SKUs) so stock/avg cost end
  up exactly as if the fake seed had never run.
- The now fully-unused fake vendors: City Electric Supply, Home Depot Pro.

Run from the api/ directory:  python scripts/remove_fake_data_20260728.py
"""

import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Item, Job, Location, StockLevel, Transaction, User, Vendor
from app.services.ledger import apply_transaction

FAKE_JOB_NUMBERS = ["JOB-1001", "JOB-1002", "JOB-1003"]
FAKE_VENDOR_NAMES = ["City Electric Supply", "Home Depot Pro"]

# Real transactions only, per affected SKU, in chronological order.
# (type, qty, unit_cost or None, date, ref, note, adjust_reason or None)
REAL_TXNS = {
    "COND-EMT34": [
        ("RECEIVE", "50", "9.375", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich", None),
        ("RECEIVE", "30", "9.805", "2026-07-27", "S130905350.001",
         "PO: CHURCH -- shipped to 7 Church Lane, Pikesville MD (no job-site location type in this system; received into Shop)", None),
        ("ADJUST", "50", None, "2026-07-27", "S130912165.001",
         "Returned to Maurice Electrical Supply -- credit memo S130912165.001 (full return of S130904332.001 line)", "other"),
    ],
    "STRAP-EMT34": [
        ("RECEIVE", "200", "0.1526", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich", None),
        ("ADJUST", "200", None, "2026-07-27", "S130912165.001",
         "Returned to Maurice Electrical Supply -- credit memo S130912165.001 (full return of S130904332.001 line)", "other"),
    ],
    "DEV-GFCI20": [
        ("RECEIVE", "12", "19.95", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich", None),
    ],
    "PLATE-1G-DUP": [
        ("RECEIVE", "80", "0.61", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich", None),
        ("ADJUST", "80", None, "2026-07-27", "S130912165.001",
         "Returned to Maurice Electrical Supply -- credit memo S130912165.001 (full return of S130904332.001 line)", "other"),
    ],
    "WIRE-12THHN-BK": [
        ("RECEIVE", "1500", "0.2125", "2026-07-28", "S130912211.001", "PO: SOLTERRA -- Maurice Electrical-Timonium", None),
    ],
    "WIRE-12THHN-WH": [
        ("RECEIVE", "1500", "0.2125", "2026-07-28", "S130912211.001", "PO: SOLTERRA -- Maurice Electrical-Timonium", None),
    ],
}


def dt(date_str: str) -> datetime:
    return datetime.strptime(date_str, "%Y-%m-%d").replace(hour=12)


def main() -> None:
    db = SessionLocal()
    try:
        # 1. Fake jobs
        jobs = db.query(Job).filter(Job.job_number.in_(FAKE_JOB_NUMBERS)).all()
        for j in jobs:
            leftover = db.query(Transaction).filter(Transaction.job_id == j.id).count()
            if leftover:
                raise SystemExit(f"{j.job_number} has {leftover} transactions -- not deleting, investigate first")
        for j in jobs:
            print(f"Deleting fake job {j.job_number}: {j.name}")
            db.delete(j)
        db.commit()

        # 2. Rebuild the 6 mixed items from only their real transactions
        admin = db.query(User).filter(User.role == "admin").first()
        shop = db.query(Location).filter(Location.type == "shop").first()
        maurice = db.query(Vendor).filter(Vendor.name == "Maurice Electrical Supply").first()

        for sku, txns in REAL_TXNS.items():
            item = db.query(Item).filter(Item.sku == sku).first()
            if not item:
                raise SystemExit(f"Item {sku} not found")

            old_txn_count = db.query(Transaction).filter(Transaction.item_id == item.id).delete(synchronize_session=False)
            db.query(StockLevel).filter(StockLevel.item_id == item.id).delete(synchronize_session=False)
            item.avg_cost = Decimal("0")
            item.last_cost = Decimal("0")
            db.flush()

            for type_, qty, cost, date_str, ref, note, reason in txns:
                if type_ == "RECEIVE":
                    txn = apply_transaction(
                        db, type="RECEIVE", item_id=item.id, qty=Decimal(qty), user=admin,
                        vendor_id=maurice.id, unit_cost=Decimal(cost),
                        to_location_id=shop.id, ref=ref, note=note,
                    )
                else:  # ADJUST (return)
                    txn = apply_transaction(
                        db, type="ADJUST", item_id=item.id, qty=Decimal(qty), user=admin,
                        from_location_id=shop.id, reason=reason, ref=ref, note=note,
                    )
                when = dt(date_str)
                txn.created_at = when
                txn.updated_at = when
            db.commit()
            print(f"Rebuilt {sku}: replaced {old_txn_count} transactions (incl. fake ones) with {len(txns)} real ones")

        # 3. Now-unused fake vendors
        for name in FAKE_VENDOR_NAMES:
            v = db.query(Vendor).filter(Vendor.name == name).first()
            if not v:
                continue
            leftover = db.query(Transaction).filter(Transaction.vendor_id == v.id).count()
            if leftover:
                raise SystemExit(f"Vendor {name} still has {leftover} transactions -- not deleting")
            print(f"Deleting fake vendor: {name}")
            db.delete(v)
        db.commit()

        print("\nDone.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
