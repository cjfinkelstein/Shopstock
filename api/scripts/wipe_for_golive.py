"""One-time cleanup before go-live: clears demo/test clock-in history,
resets every item back to a blank slate (keeping only its name and photo),
and clears every Team Calendar to-do/task.

Items are NOT deleted -- only reset, keeping `name` and `image_data`:
  - sku and barcode get a fresh unique placeholder ("ITEM-<id>")
  - category resets to "Uncategorized"
  - reorder_point, reorder_qty, avg_cost, last_cost reset to 0
  - every stock_levels row is deleted (no row = zero on hand, same as the
    app already treats an item with no stock_levels row)
  - every transaction (the ledger) is deleted

Leaves fully untouched: user accounts (admin + all techs), trucks, jobs,
vendors, estimates, expenses, PTO records, and clock-out photos (detached
from their now-deleted shift instead of deleted, since they're a separate
feature).

Defaults to a dry run that only prints what it would change. Pass --yes to
actually commit -- this cannot be undone, so take a database backup first.

Usage (from api/, inside the container):
    python scripts/wipe_for_golive.py            # dry run
    python scripts/wipe_for_golive.py --yes       # actually applies it
"""
import argparse
import sys

sys.path.insert(0, ".")

from app.database import SessionLocal
from app.models import (
    CalendarEvent, CalendarEventEdit, ClockEvent, ClockOutPhoto, Item,
    LocationPing, LoginEvent, StockLevel, Transaction,
)


def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        item_count = db.query(Item).count()
        counts = {
            "clock_events (shift history) -- deleted": db.query(ClockEvent).count(),
            "location_pings (GPS trail) -- deleted": db.query(LocationPing).count(),
            "login_events (tap-in log) -- deleted": db.query(LoginEvent).count(),
            "clock_out_photos -- kept, just detached from the deleted shift":
                db.query(ClockOutPhoto).filter(ClockOutPhoto.clock_event_id.isnot(None)).count(),
            "items -- kept, reset to just name + photo": item_count,
            "stock_levels -- deleted (all quantities back to zero)": db.query(StockLevel).count(),
            "transactions (ledger) -- deleted": db.query(Transaction).count(),
            "calendar_events (to-dos/tasks) -- deleted": db.query(CalendarEvent).count(),
            "calendar_event_edits (history) -- deleted": db.query(CalendarEventEdit).count(),
        }
        print("About to apply:")
        for label, n in counts.items():
            print(f"  {n:>6}  {label}")

        if not apply:
            print("\nDry run only -- nothing changed. Re-run with --yes to actually delete.")
            return

        # Detach rows that should survive even though what they pointed at
        # is being deleted.
        db.query(ClockOutPhoto).update({"clock_event_id": None}, synchronize_session=False)

        # Clock-in/out history -- deepest foreign key first.
        db.query(LocationPing).delete(synchronize_session=False)
        db.query(ClockEvent).delete(synchronize_session=False)
        db.query(LoginEvent).delete(synchronize_session=False)

        # Stock quantities and the ledger -- items themselves stay.
        db.query(StockLevel).delete(synchronize_session=False)
        db.query(Transaction).delete(synchronize_session=False)
        for item in db.query(Item):
            item.sku = f"ITEM-{item.id}"
            item.barcode = f"ITEM-{item.id}"
            item.category = "Uncategorized"
            item.reorder_point = 0
            item.reorder_qty = 0
            item.avg_cost = 0
            item.last_cost = 0

        # Calendar, past and future -- edit history first (same FK order as
        # migration 0026's hotfix, for the same reason).
        db.query(CalendarEventEdit).delete(synchronize_session=False)
        db.query(CalendarEvent).delete(synchronize_session=False)

        db.commit()
        print("\nDone.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="actually apply (default is a dry run)")
    args = parser.parse_args()
    main(apply=args.yes)
