"""One-time cleanup before go-live: clears demo/test clock-in history, the
item catalog (and everything that hangs off it), and every Team Calendar
to-do/task.

Leaves untouched: user accounts (admin + all techs), trucks, jobs, vendors,
estimates, expenses, PTO records, and clock-out photos (detached from their
now-deleted shift instead of deleted, since they're a separate feature).

Defaults to a dry run that only prints what it would delete. Pass --yes to
actually commit the deletion -- this cannot be undone, so take a database
backup first.

Usage (from api/, inside the container):
    python scripts/wipe_for_golive.py            # dry run
    python scripts/wipe_for_golive.py --yes       # actually deletes
"""
import argparse
import sys

sys.path.insert(0, ".")

from app.database import SessionLocal
from app.models import (
    CalendarEvent, CalendarEventEdit, ClockEvent, ClockOutPhoto, EstimateLine,
    Item, LocationPing, LoginEvent, StockLevel, Transaction,
)


def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        counts = {
            "clock_events (shift history)": db.query(ClockEvent).count(),
            "location_pings (GPS trail)": db.query(LocationPing).count(),
            "login_events (tap-in log)": db.query(LoginEvent).count(),
            "clock_out_photos -- kept, just detached from the deleted shift":
                db.query(ClockOutPhoto).filter(ClockOutPhoto.clock_event_id.isnot(None)).count(),
            "items (catalog)": db.query(Item).count(),
            "stock_levels": db.query(StockLevel).count(),
            "transactions (ledger)": db.query(Transaction).count(),
            "estimate_lines referencing an item -- kept, just detached":
                db.query(EstimateLine).filter(EstimateLine.item_id.isnot(None)).count(),
            "calendar_events (to-dos/tasks)": db.query(CalendarEvent).count(),
            "calendar_event_edits (history)": db.query(CalendarEventEdit).count(),
        }
        print("About to clear:")
        for label, n in counts.items():
            print(f"  {n:>6}  {label}")

        if not apply:
            print("\nDry run only -- nothing changed. Re-run with --yes to actually delete.")
            return

        # Detach rows that should survive even though what they pointed at
        # is being deleted.
        db.query(ClockOutPhoto).update({"clock_event_id": None}, synchronize_session=False)
        db.query(EstimateLine).update({"item_id": None}, synchronize_session=False)

        # Clock-in/out history -- deepest foreign key first.
        db.query(LocationPing).delete(synchronize_session=False)
        db.query(ClockEvent).delete(synchronize_session=False)
        db.query(LoginEvent).delete(synchronize_session=False)

        # Item catalog and everything that hangs off it.
        db.query(StockLevel).delete(synchronize_session=False)
        db.query(Transaction).delete(synchronize_session=False)
        db.query(Item).delete(synchronize_session=False)

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
    parser.add_argument("--yes", action="store_true", help="actually delete (default is a dry run)")
    args = parser.parse_args()
    main(apply=args.yes)
