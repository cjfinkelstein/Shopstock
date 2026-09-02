"""Zero out on-hand stock for every item: Maurice Electrical Supply doesn't
sell in bulk, so material isn't warehoused -- it's bought and used directly
on the job. The RECEIVE transactions (real purchase history/cost) stay
intact; this just adds an ADJUST bringing shop quantity down to 0, same
pattern as any other stock correction in the app.

Run from the api/ directory:  python scripts/zero_out_stock_20260728.py
"""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Item, Location, StockLevel, User
from app.services.ledger import apply_transaction

NOTE = "Maurice Electrical Supply doesn't sell in bulk -- material is used directly on the job, not warehoused in shop stock."


def main() -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").first()
        shop = db.query(Location).filter(Location.type == "shop").first()

        rows = (
            db.query(StockLevel)
            .filter(StockLevel.location_id == shop.id, StockLevel.qty > 0)
            .all()
        )
        count = 0
        for row in rows:
            item = db.get(Item, row.item_id)
            apply_transaction(
                db, type="ADJUST", item_id=item.id, qty=row.qty, user=admin,
                from_location_id=shop.id, reason="other", note=NOTE,
            )
            print(f"{item.sku}: {row.qty} -> 0")
            count += 1
        db.commit()
        print(f"\nZeroed out {count} items")
    finally:
        db.close()


if __name__ == "__main__":
    main()
