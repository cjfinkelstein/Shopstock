"""One-time cleanup: purge the 14 leftover fictional demo items (and their
opening-stock / truck-transfer transactions) that were never touched by the
real Maurice Electrical Supply data. Confirmed with the user in conversation
on 2026-07-28.

Deletes in FK-safe order: transactions -> stock levels -> items.

Run from the api/ directory:  python scripts/remove_demo_items_20260728.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Item, StockLevel, Transaction

REMOVE_SKUS = [
    "ANCH-EZ100", "BOX-1G-OW", "BOX-4SQ", "BRKR-QO120", "COND-ENT34",
    "CONN-EMT34-50", "DEV-REC15", "DEV-SW1P", "GRND-ROD8", "STAPLE-NM100",
    "TAPE-ELEC", "WIRE-122NM", "WIRE-142NM", "WN-YEL100",
]


def main() -> None:
    db = SessionLocal()
    try:
        items = db.query(Item).filter(Item.sku.in_(REMOVE_SKUS)).all()
        found_skus = {i.sku for i in items}
        missing = set(REMOVE_SKUS) - found_skus
        if missing:
            print(f"Not found (already removed?): {sorted(missing)}")
        ids = [i.id for i in items]

        txn_deleted = db.query(Transaction).filter(Transaction.item_id.in_(ids)).delete(synchronize_session=False)
        stock_deleted = db.query(StockLevel).filter(StockLevel.item_id.in_(ids)).delete(synchronize_session=False)
        for i in items:
            db.delete(i)
        db.commit()

        print(f"Deleted {txn_deleted} transactions, {stock_deleted} stock rows, {len(items)} items:")
        for sku in sorted(found_skus):
            print(f"  {sku}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
