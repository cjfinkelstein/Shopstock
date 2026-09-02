"""Attach each Maurice invoice's real Customer PO Number to the job it
belongs to. SOLTERRA -> Solterra RVA (all SOLTERRA invoices shipped from/
picked up at the Richmond branch, i.e. RVA). CHURCH -> 7 Church Lane (exact
ship-to address match).

Since these items aren't warehoused (previous correction: "Maurice doesn't
sell in bulk"), the correct ledger representation of "this material was for
job X" is a SIGN_OUT to that job, not a text note -- that's what drives job
costing/reporting in this app. This script:
  1. Deletes the generic "doesn't sell in bulk" ADJUST for every item whose
     invoice PO resolves to a real job (29 of the 32 zero-out rows).
  2. Replaces them with proper SIGN_OUT transactions to the correct job, at
     the exact net quantity that was never returned to the vendor (a few
     items were fully returned via credit memo S130912165.001 -- those get
     $0 / no sign-out, since that material never reached any job).

1407 SHOEMAKER (WIRE-SEU666, FITT-SC1SEC, DISC-DPU222R) doesn't match any
existing job -- left as a generic ADJUST, unresolved, pending user input.

Run from the api/ directory:  python scripts/attach_jobs_20260728.py
"""

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Item, Job, Location, Transaction, User
from app.services.ledger import apply_transaction

# (sku, qty, date, ref, note)
SOLTERRA_SIGNOUTS = [
    ("WIRE-12THHN-BK", "1500", "2026-07-28", "S130912211.001", "PO: SOLTERRA"),
    ("WIRE-12THHN-RD", "1500", "2026-07-28", "S130912211.001", "PO: SOLTERRA"),
    ("WIRE-12THHN-BLSTR", "1500", "2026-07-28", "S130912211.001", "PO: SOLTERRA"),
    ("WIRE-12THHN-WH", "1500", "2026-07-28", "S130912211.001", "PO: SOLTERRA"),
    ("WIRE-12THHN-GRN", "1000", "2026-07-28", "S130912211.001", "PO: SOLTERRA"),
    ("LABEL-PCMB3", "1", "2026-07-28", "S130912211.001", "PO: SOLTERRA"),
    ("FITT-CADHANGER", "62", "2026-07-28", "S130912211.002", "PO: SOLTERRA"),
    ("FITT-EMTCONN34-EA", "25", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("COND-PVC1", "1", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("FITT-PVCCAP1", "2", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("PLATE-1G-DECO", "33", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("WIRE-18-4C-PLEN", "1000", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("FITT-BXDUPLEX38", "100", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("FITT-BXCOMBO38", "100", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("DEV-WPCOVER", "5", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("DEV-GFCI20", "12", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("PLATE-2G-DECO", "20", "2026-07-27", "S130904332.001", "PO: SOLTERRA"),
    ("DEV-DIMMER-3WY", "26", "2026-07-27", "S130904332.002", "PO: SOLTERRA"),
    ("CTRL-PIRCEIL", "30", "2026-07-27", "S130904332.002", "PO: SOLTERRA"),
    ("CTRL-PP20", "26", "2026-07-27", "S130904332.002", "PO: SOLTERRA"),
    ("DEV-REC20-DECO", "80", "2026-07-27", "S130904332.002", "PO: SOLTERRA"),
    ("DEV-REC20", "20", "2026-07-27", "S130904332.002", "PO: SOLTERRA"),
    ("BOX-4SQ-DEEP", "10", "2026-07-27", "S130904332.003", "PO: SOLTERRA"),
    ("BOX-4SQ-GB", "10", "2026-07-27", "S130904332.003", "PO: SOLTERRA"),
    ("PLATE-1G-DECO", "80", "2026-07-28", "S130904332.004", "PO: SOLTERRA"),
    ("COND-LQT34", "100", "2026-07-21", "S130868397.001", "PO: SOLTERRA"),
    ("FITT-LQTCONN-STR", "6", "2026-07-21", "S130868397.001", "PO: SOLTERRA"),
    ("FITT-LQTCONN-90", "4", "2026-07-21", "S130868397.001", "PO: SOLTERRA"),
]

CHURCH_SIGNOUTS = [
    ("COND-EMT34", "30", "2026-07-27", "S130905350.001", "PO: CHURCH"),
    ("FITT-EMTCONN34-EA", "50", "2026-07-27", "S130905350.001", "PO: CHURCH"),
    ("FITT-EMTCOUP34", "25", "2026-07-27", "S130905350.001", "PO: CHURCH"),
]

# SKUs whose zero-out ADJUST should be deleted (superseded by a SIGN_OUT above)
RESOLVED_SKUS = {sku for sku, *_ in SOLTERRA_SIGNOUTS} | {sku for sku, *_ in CHURCH_SIGNOUTS}


def dt(date_str: str) -> datetime:
    return datetime.strptime(date_str, "%Y-%m-%d").replace(hour=14)


def main() -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").first()
        shop = db.query(Location).filter(Location.type == "shop").first()
        solterra = db.query(Job).filter(Job.name == "Solterra RVA").first()
        church = db.query(Job).filter(Job.name == "7 Church Lane").first()
        if not solterra or not church:
            raise SystemExit("Solterra RVA or 7 Church Lane job not found")

        # 1. Delete the superseded zero-out ADJUST rows (by sku, not blanket --
        # leaves the 3 unresolved 1407 Shoemaker rows untouched)
        zero_outs = db.query(Transaction).filter(
            Transaction.type == "ADJUST", Transaction.note.like("%bulk%")
        ).all()
        deleted = 0
        for t in zero_outs:
            if t.item.sku in RESOLVED_SKUS:
                db.delete(t)
                deleted += 1
        db.commit()
        print(f"Deleted {deleted} superseded zero-out ADJUST rows")

        # 2. Sign out to Solterra RVA
        for sku, qty, date_str, ref, note in SOLTERRA_SIGNOUTS:
            item = db.query(Item).filter(Item.sku == sku).first()
            txn = apply_transaction(
                db, type="SIGN_OUT", item_id=item.id, qty=qty, user=admin,
                from_location_id=shop.id, job_id=solterra.id, ref=ref, note=note,
            )
            when = dt(date_str)
            txn.created_at = when
            txn.updated_at = when
        db.commit()
        print(f"Signed out {len(SOLTERRA_SIGNOUTS)} lines to Solterra RVA")

        # 3. Sign out to 7 Church Lane
        for sku, qty, date_str, ref, note in CHURCH_SIGNOUTS:
            item = db.query(Item).filter(Item.sku == sku).first()
            txn = apply_transaction(
                db, type="SIGN_OUT", item_id=item.id, qty=qty, user=admin,
                from_location_id=shop.id, job_id=church.id, ref=ref, note=note,
            )
            when = dt(date_str)
            txn.created_at = when
            txn.updated_at = when
        db.commit()
        print(f"Signed out {len(CHURCH_SIGNOUTS)} lines to 7 Church Lane")

        remaining = db.query(Transaction).filter(
            Transaction.type == "ADJUST", Transaction.note.like("%bulk%")
        ).all()
        print(f"\nStill unattributed (1407 SHOEMAKER, no matching job): "
              f"{[t.item.sku for t in remaining]}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
