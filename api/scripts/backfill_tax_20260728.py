"""Backfill tax_amount on existing RECEIVE transactions, using each
invoice's real subtotal/tax from the source PDFs and spreadsheet. Tax is
allocated per line proportional to that line's share of the invoice
subtotal (Maurice doesn't break tax out per line, only per invoice).

Run from the api/ directory:  python scripts/backfill_tax_20260728.py
"""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Transaction

# invoice ref -> (subtotal, tax) -- from the original PDFs (batch 1) and the
# xlsx Summary sheet (batch 2)
INVOICE_TAX = {
    "S130912211.001": ("1584.03", "95.04"),
    "S130912211.002": ("66.33", "3.98"),
    "S130916367.001": ("178.37", "10.71"),
    "S130916367.002": ("46.58", "2.80"),
    "S130904332.001": ("1351.31", "81.08"),
    "S130904332.002": ("4555.00", "273.30"),
    "S130904332.003": ("41.02", "2.46"),
    "S130904332.004": ("51.20", "3.07"),
    "S130905350.001": ("322.57", "19.36"),
    "S130868397.001": ("255.84", "15.35"),
    "S130757413.001": ("705.13", "42.31"),
    "S130768997.001": ("284.00", "17.04"),
    "S130771897.001": ("162.76", "9.77"),
    "S130771897.003": ("63.44", "3.81"),
    "S130771897.004": ("99.81", "5.99"),
    "S130771897.005": ("4.75", "0.28"),
    "S130777442.001": ("124.07", "7.44"),
    "S130798695.001": ("210.25", "12.64"),
    "S130802464.001": ("2650.00", "159.00"),
    "S130806748.001": ("66.06", "4.00"),
    "S130812667.001": ("69.59", "4.18"),
    "S130819819.001": ("373.08", "22.39"),
    "S130828067.001": ("334.53", "20.08"),
    "S130830514.001": ("662.32", "39.74"),
    "S130838431.001": ("1427.90", "85.67"),
    "S130839453.001": ("248.14", "14.91"),
    "S130840069.001": ("95.34", "5.72"),
    "S130848496.001": ("1075.73", "64.56"),
    "S130859508.001": ("326.06", "19.56"),
    "S130865854.001": ("259.58", "15.57"),
    "S130712071.001": ("296.60", "17.83"),
    "S130698195.001": ("13.32", "0.80"),
    "S130698215.001": ("24.16", "1.46"),
    "S130702882.001": ("1560.16", "93.64"),
    "S130703608.001": ("85.12", "5.12"),
    "S130693675.001": ("296.00", "17.76"),
    "S130677729.001": ("1718.92", "103.17"),
    "S130681568.001": ("27.96", "1.69"),
    "S130667764.002": ("390.00", "23.40"),
    "S130672339.001": ("557.01", "33.48"),
    "S130663174.004": ("411.18", "24.79"),
    "S130663174.002": ("124.00", "7.44"),
    "S130653436.001": ("821.94", "49.33"),
}


def main() -> None:
    db = SessionLocal()
    try:
        updated = 0
        missing_refs = set()
        for ref, (subtotal_s, tax_s) in INVOICE_TAX.items():
            txns = db.query(Transaction).filter(Transaction.type == "RECEIVE", Transaction.ref == ref).all()
            if not txns:
                continue
            total_ext = sum((Decimal(str(t.qty)) * Decimal(str(t.unit_cost or 0)) for t in txns), Decimal("0"))
            tax = Decimal(tax_s)
            if total_ext == 0:
                continue
            allocated = Decimal("0")
            for i, t in enumerate(txns):
                ext = Decimal(str(t.qty)) * Decimal(str(t.unit_cost or 0))
                if i == len(txns) - 1:
                    share = (tax - allocated).quantize(Decimal("0.01"))
                else:
                    share = (ext / total_ext * tax).quantize(Decimal("0.01"))
                    allocated += share
                t.tax_amount = share
                updated += 1
        db.commit()

        all_receive_refs = {r[0] for r in db.query(Transaction.ref).filter(Transaction.type == "RECEIVE", Transaction.ref.isnot(None)).distinct()}
        for r in all_receive_refs:
            if r not in INVOICE_TAX:
                missing_refs.add(r)

        print(f"Updated tax_amount on {updated} RECEIVE transactions across {len(INVOICE_TAX)} invoices")
        if missing_refs:
            print(f"RECEIVE refs with no known tax data (left untouched): {sorted(missing_refs)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
