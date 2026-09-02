"""Home Depot Apex-card purchases (Purchase_History_July-28-2026_4-35-PM.csv).

Filtered to the 214 rows whose "Card/Account Nickname" contains "apex"
(Sam's/Ed's/Avigdor's/Al's/Shuie's Apex cards -- all charged by Al Engel).
13 of those have a negative Total Amount Paid (mid-stream credits/returns on
receipts not otherwise in this export) -- excluded, reported at the end.

No line-item detail exists in this data (receipt totals only), so each row
becomes one RECEIVE + immediate SIGN_OUT of a generic "Home Depot Materials"
placeholder item, done one row at a time so the moving-average cost snapshot
at SIGN_OUT time always equals that exact receipt's own pre-tax amount (on
hand returns to 0 after every pair, so the next RECEIVE's avg_cost calc sees
0 on hand and takes the new unit_cost outright -- same technique used for
the Maurice imports). Tax is tracked separately via tax_amount, matching the
"material cost basis excludes tax" rule already in place.

"Job Name" on the CSV is extremely inconsistent (typos, case, abbreviations)
-- mapped by hand below, confirmed with the user: existing jobs matched by
abbreviation/typo, 16 new job sites created, ~20 unresolved rows (blank,
ticket numbers, non-job words like "work"/"STOCK"/"VAN") go to Miscellaneous.

Run from the api/ directory:  python scripts/import_homedepot_20260728.py
"""

import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Item, Job, Location, User, Vendor
from app.services.ledger import apply_transaction

CSV = r"C:\Users\CJFinkelstein\Downloads\Purchase_History_July-28-2026_4-35-PM.csv"

NEW_JOBS = [
    "Walker Mill", "Strathmore", "Rubin", "Old Court", "Bethesda Sterling Care",
    "6816 Chippewa Dr", "Oaklee", "Ner Tamid", "Madison Gardens",
    "Autumn Lake Crofton", "2604 Taney Rd", "207 Colchester Rd", "300 Gateway",
    "2715 Smith", "3220 Swann Rd", "Evanston",
]

# raw "Job Name" (lowercased, stripped) -> target job name
JOB_MAP = {
    # Glen Mikvah
    "glen": "Glen Mikvah", "glen mikva": "Glen Mikvah", "glen mikvah": "Glen Mikvah",
    "glen ave": "Glen Mikvah",
    # Goldstein Addition
    "goldstein addition": "Goldstein Addition", "goldstein": "Goldstein Addition",
    "gold": "Goldstein Addition",
    # 7 Church Lane
    "church": "7 Church Lane", "7 church lane": "7 Church Lane", "church lane": "7 Church Lane",
    "7 church ln": "7 Church Lane", "7 church": "7 Church Lane", "apex 7 church": "7 Church Lane",
    "7 chruch ln": "7 Church Lane",
    # 3214 Timberfield Renovation
    "timberfield": "3214 Timberfield Renovation", "timberfeild": "3214 Timberfield Renovation",
    "3214 timberfield": "3214 Timberfield Renovation", "timberfield ln": "3214 Timberfield Renovation",
    "timber fleid": "3214 Timberfield Renovation", "timberfliield": "3214 Timberfield Renovation",
    "917 timberfield": "3214 Timberfield Renovation",
    # Parham One Richmond
    "parham one": "Parham One Richmond", "parham 1": "Parham One Richmond",
    "parham and van": "Parham One Richmond", "parham": "Parham One Richmond",
    # Solterra RVA / Norfolk
    "solterra": "Solterra RVA", "solterra rva": "Solterra RVA",
    "norfolk sulterra": "Solterra Norfolk", "solterra norfolk": "Solterra Norfolk",
    # Freedom Recovery
    "freedom": "Freedom Recovery", "freedom va": "Freedom Recovery", "aeg freedom": "Freedom Recovery",
    "freedom recovery": "Freedom Recovery", "recovery center": "Freedom Recovery",
    # 7630 Carla Rd
    "carla rd": "7630 Carla Rd",
    # 71 Monnett
    "monnett": "71 Monnett", "monnet": "71 Monnett",
    # 3500 Arborwood Ct
    "arborwood": "3500 Arborwood Ct",
    # Etz Chaim
    "etz chaim": "Etz Chaim",
    # New jobs
    "walker mill": "Walker Mill", "walkermill": "Walker Mill", "walker mill stov": "Walker Mill",
    "6954 walker unit c2": "Walker Mill", "6954 walker unit": "Walker Mill", "6954 walker mill": "Walker Mill",
    "strathmore": "Strathmore",
    "rubin": "Rubin",
    "old court": "Old Court",
    "bethesda sterling": "Bethesda Sterling Care", "bethesda sterling ca": "Bethesda Sterling Care",
    "sterling care": "Bethesda Sterling Care",
    "6816 chippewa dr": "6816 Chippewa Dr",
    "oaklee": "Oaklee", "wao oaklee": "Oaklee",
    "ner tamid": "Ner Tamid",
    "madison": "Madison Gardens", "madison gardens": "Madison Gardens", "madison garden apt": "Madison Gardens",
    "autumn lake crofton": "Autumn Lake Crofton", "autumn lake crof": "Autumn Lake Crofton",
    "2604 taney rd": "2604 Taney Rd", "2604 taney": "2604 Taney Rd", "taney": "2604 Taney Rd",
    "207 colchester": "207 Colchester Rd", "207colchester ro": "207 Colchester Rd",
    "300 gateway": "300 Gateway",
    "2715 smith": "2715 Smith",
    "3220 swann rd": "3220 Swann Rd",
    "evanston": "Evanston",
}
# everything else (NaN, "work", "TI", "VAN", "LADDER", ticket numbers, etc.) -> Miscellaneous


def main() -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").first()
        shop = db.query(Location).filter(Location.type == "shop").first()

        vendor = db.query(Vendor).filter(Vendor.name == "Home Depot").first()
        if not vendor:
            vendor = Vendor(name="Home Depot", active=True)
            db.add(vendor)
            db.commit()
            print("Created vendor: Home Depot")

        item = db.query(Item).filter(Item.sku == "MISC-HOMEDEPOT").first()
        if not item:
            item = Item(
                sku="MISC-HOMEDEPOT", barcode="MISC-HOMEDEPOT", name="Home Depot Materials",
                description="Placeholder for Home Depot receipts with no itemized material detail",
                category="Consumables", unit="each", active=True,
            )
            db.add(item)
            db.commit()
            print("Created item: Home Depot Materials (MISC-HOMEDEPOT)")

        job_by_name: dict[str, Job] = {}
        for name in NEW_JOBS:
            j = db.query(Job).filter(Job.name == name).first()
            if not j:
                nums = [int(x.job_number.split("-")[1]) for x in db.query(Job).all() if x.job_number.startswith("JOB-")]
                j = Job(job_number=f"JOB-{max(nums) + 1}", name=name, status="active")
                db.add(j)
                db.commit()
                print(f"Created {j.job_number}: {name}")
            job_by_name[name] = j

        misc = db.query(Job).filter(Job.name == "Miscellaneous").first()

        df = pd.read_csv(CSV, skiprows=6)
        for col in ["Pre-tax Amount", "Total Amount Paid"]:
            df[col] = df[col].replace(r"[\$,]", "", regex=True).astype(float)
        apex = df[df["Card/Account Nickname"].str.contains("apex", case=False, na=False)].copy()

        excluded_negative = apex[apex["Total Amount Paid"] < 0]
        rows = apex[apex["Total Amount Paid"] >= 0]

        signed_count = 0
        misc_count = 0
        for _, row in rows.iterrows():
            raw_job = row["Job Name"]
            key = str(raw_job).strip().lower() if pd.notna(raw_job) else ""
            target_name = JOB_MAP.get(key)
            if target_name:
                job = job_by_name.get(target_name) or db.query(Job).filter(Job.name == target_name).first()
            else:
                job = misc
                misc_count += 1

            pretax = Decimal(str(row["Pre-tax Amount"])).quantize(Decimal("0.0001"))
            tax = (Decimal(str(row["Total Amount Paid"])) - Decimal(str(row["Pre-tax Amount"]))).quantize(Decimal("0.01"))
            ref = str(int(row["Transaction ID"])) if pd.notna(row["Transaction ID"]) else None
            note = f"Home Depot receipt -- job field on receipt: {raw_job if pd.notna(raw_job) else '(blank)'}, purchaser: {row['Purchaser']}"
            when = datetime.strptime(row["Date"], "%Y-%m-%d").replace(hour=16)

            r_txn = apply_transaction(
                db, type="RECEIVE", item_id=item.id, qty=Decimal("1"), user=admin,
                vendor_id=vendor.id, unit_cost=pretax, tax_amount=tax, ref=ref, note=note,
            )
            r_txn.created_at = when
            r_txn.updated_at = when

            s_txn = apply_transaction(
                db, type="SIGN_OUT", item_id=item.id, qty=Decimal("1"), user=admin,
                from_location_id=shop.id, job_id=job.id, ref=ref, note=note,
            )
            s_txn.created_at = when
            s_txn.updated_at = when
            db.commit()
            signed_count += 1

        print(f"\nImported {signed_count} Home Depot receipts")
        print(f"  -> {misc_count} unresolved rows went to Miscellaneous")
        print(f"Excluded {len(excluded_negative)} negative/credit rows, totaling ${excluded_negative['Total Amount Paid'].sum():.2f}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
