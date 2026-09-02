"""Create "Wallis" and "Miscellaneous" jobs, and sign out their material to
them -- same pattern as the Shoemaker fix. Wood Ct / Wood Court are left
alone pending which real job they belong to.

Run from the api/ directory:  python scripts/attach_wallis_misc_20260728.py
"""

import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Item, Job, Location, StockLevel, Transaction, User

WALLIS_SKUS = {
    "WIRE-SER2224": "50", "FITT-SC50S1": "2", "BRKR-BR120": "7",
    "GRND-GBKP1420": "1", "CONSUM-DUCTSEAL": "1", "STRAP-EMT34": "10",
    "CONSUM-NOALOX": "1",
}
MISC_SKUS = {"BRKR-TQDHW": "1", "BRKR-THQD32175": "3"}

WHEN = datetime(2026, 7, 10, 15, 0)  # Wallis invoice date; Misc uses its own


def main() -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").first()
        shop = db.query(Location).filter(Location.type == "shop").first()

        wallis = Job(job_number="JOB-1024", name="Wallis", status="active")
        misc = Job(job_number="JOB-1025", name="Miscellaneous", status="active")
        db.add_all([wallis, misc])
        db.commit()
        print("Created JOB-1024: Wallis")
        print("Created JOB-1025: Miscellaneous")

        for target_job, skus, when in [
            (wallis, WALLIS_SKUS, datetime(2026, 7, 10, 15, 0)),
            (misc, MISC_SKUS, datetime(2026, 7, 14, 15, 0)),
        ]:
            for sku, qty in skus.items():
                # delete the superseded zero-out ADJUST for this sku
                old = (
                    db.query(Transaction)
                    .join(Item)
                    .filter(Transaction.type == "ADJUST", Transaction.note.like("%bulk%"), Item.sku == sku)
                    .first()
                )
                if old:
                    db.delete(old)
                    db.commit()

                item = db.query(Item).filter(Item.sku == sku).first()
                from app.services.ledger import apply_transaction
                txn = apply_transaction(
                    db, type="SIGN_OUT", item_id=item.id, qty=Decimal(qty), user=admin,
                    from_location_id=shop.id, job_id=target_job.id,
                    note=f"Reassigned from unresolved PO to {target_job.name}",
                )
                txn.created_at = when
                txn.updated_at = when
                db.commit()
                print(f"  {sku} -> {target_job.name}")

        # deleting old ADJUST rows doesn't reverse their stock_levels effect
        neg = db.query(StockLevel).filter(StockLevel.qty < 0).all()
        for row in neg:
            print(f"Correcting stock_levels: {row.item.sku} {row.qty} -> 0")
            row.qty = Decimal("0")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
