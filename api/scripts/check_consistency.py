"""Proves the ledger reconciles to stock_levels.

For every (item, location): sum(transactions INTO) - sum(transactions OUT OF)
must equal stock_levels.qty exactly. Exits 1 on any mismatch.

Run from the api/ directory (or the api container):  python scripts/check_consistency.py
"""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Item, Location, StockLevel, Transaction

QTY_EXP = Decimal("0.01")


def main() -> int:
    db = SessionLocal()
    try:
        ledger: dict[tuple[int, int], Decimal] = {}
        for t in db.scalars(select(Transaction)).all():
            qty = Decimal(str(t.qty))
            if t.from_location_id is not None:
                key = (t.item_id, t.from_location_id)
                ledger[key] = ledger.get(key, Decimal("0")) - qty
            if t.to_location_id is not None:
                key = (t.item_id, t.to_location_id)
                ledger[key] = ledger.get(key, Decimal("0")) + qty

        stock: dict[tuple[int, int], Decimal] = {}
        for s in db.scalars(select(StockLevel)).all():
            stock[(s.item_id, s.location_id)] = Decimal(str(s.qty))

        items = {i.id: i for i in db.scalars(select(Item)).all()}
        locs = {l.id: l for l in db.scalars(select(Location)).all()}

        mismatches = []
        for key in sorted(set(ledger) | set(stock)):
            lsum = ledger.get(key, Decimal("0")).quantize(QTY_EXP)
            ssum = stock.get(key, Decimal("0")).quantize(QTY_EXP)
            if lsum != ssum:
                item = items.get(key[0])
                loc = locs.get(key[1])
                mismatches.append(
                    f"  {item.sku if item else key[0]} @ {loc.name if loc else key[1]}: "
                    f"ledger={lsum} stock_levels={ssum} (diff {ssum - lsum})"
                )

        checked = len(set(ledger) | set(stock))
        if mismatches:
            print(f"INCONSISTENT — {len(mismatches)} of {checked} item/location pairs do not reconcile:")
            print("\n".join(mismatches))
            return 1
        print(f"OK — ledger reconciles to stock_levels for all {checked} item/location pairs.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
