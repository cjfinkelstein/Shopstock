"""One-time historical backfill: real Maurice Electrical Supply orders (not the
demo/opening-stock bulk seed). Source: 15 PDFs (invoices + credit memos) for
APEX ELECTRICAL GROUP, dated 07/21/2026-07/28/2026.

Matches line items against existing items where the spec genuinely matches
(e.g. the 3/4" EMT stick, EMT straps, black/white THHN, GFCI, duplex plate
already in the system were modeled on these same real purchases). Everything
else becomes a new item.

Excluded on purpose (see conversation — no --minimal-style flag, this is a
one-shot script, re-run only after clearing these rows):
  - S130917434.001: AR service/late charge — not a material transaction.
  - S130905443.001, S130902486.001, S130879813.001: credit memos returning
    material from orders *not* in this batch (S130865854, S130682279,
    S130488820, S130771897, S130768997, S129434115) — recording only the
    return side would put brand-new items at negative stock with no history
    behind them. Totals: -$1186.18, -$201.50, -$518.91.

Run from the api/ directory:  python scripts/import_maurice_20260728.py
"""

import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal, Base, engine
from app.models import Item, Location, User, Vendor
from app.services.ledger import apply_transaction

VENDOR_NAME = "Maurice Electrical Supply"

# (sku, name, description, category, unit, reorder_point, reorder_qty)
NEW_ITEMS = [
    ("WIRE-12THHN-RD", "12 AWG THHN Red (per ft)", "WCU THHN 12 CU SOL RED 500' SPOOL", "Wire", "foot", "500", "2500"),
    ("WIRE-12THHN-BLSTR", "12 AWG THHN Stranded Blue (per ft)", "WCU THHN 12 CU STR BLUE 500' SPOOL", "Wire", "foot", "500", "2500"),
    ("WIRE-12THHN-GRN", "12 AWG THHN Green (per ft)", "WCU THHN 12 CU SOL GREEN 500' SPOOL", "Wire", "foot", "500", "2500"),
    ("LABEL-PCMB3", "Wire Marker Book 1-45", "PAND PCMB-3 1 THRU 45 COMB BOOK", "Consumables", "each", "1", "3"),
    ("FITT-CADHANGER", "Conduit Hanger, MC/AC/BX to #8 Wire", "CAD KX CONDUIT HANGER MC/AC OR BX TO #8 WIRE", "Fittings", "each", "50", "200"),
    ("WIRE-SEU666", "SEU Service Entrance Cable 6-6-6 CU (per ft)", "WCU SEU 6-6-6 CU 500' REEL", "Wire", "foot", "50", "200"),
    ("FITT-SC1SEC", '3/4" Die-Cast Service Entrance Connector', "SEPCO SC1 3/4\" DIE CAST SERVICE ENTRANCE CONNECTOR", "Fittings", "each", "5", "20"),
    ("DISC-DPU222R", "60A Non-Fused Pullout Disconnect NEMA3R", "CH DPU222R 60A 1PH 240V AC NON-FUSED PULLOUT NEMA3R", "Disconnects", "each", "2", "6"),
    ("FITT-EMTCOUP34", '3/4" EMT Set-Screw Coupling', "SEPCO S1114 3/4\" STL SS EMT COUP", "Fittings", "each", "50", "200"),
    ("FITT-EMTCONN34-EA", '3/4" EMT Set-Screw Connector (each)', "SEPCO S1111 3/4\" STL SS EMT CONN", "Fittings", "each", "50", "200"),
    ("COND-PVC1", '1" PVC SCH40 10\' Stick', "PVC SCH 40 1\" X 10' PIPE", "Conduit", "each", "10", "30"),
    ("FITT-PVCCAP1", '1" PVC End Cap', "CLN E958F 1\" PVC END CAP", "Fittings", "each", "5", "20"),
    ("PLATE-1G-DECO", "1-Gang Decora Wall Plate White", "LEV PJ26-W WHITE 1 GANG DECO MIDWAY NYLON W/CAP SCR WALL PLATE", "Devices", "each", "50", "200"),
    ("WIRE-18-4C-PLEN", "18/4C Plenum Rated Control Cable (per ft)", "WPW 25244B1000 18/4C GRAY STRANDED UNSHIELDED PLENUM RATED 300V CMP CABLE", "Wire", "foot", "250", "1000"),
    ("FITT-BXDUPLEX38", '3/8" Die-Cast Duplex BX Connector', "SEPCO C270A 3/8\" DIE CAST DUPLEX BX 1 SCREW CLAMP CONNECTOR", "Fittings", "each", "50", "200"),
    ("FITT-BXCOMBO38", '3/8" Die-Cast RX/BX Combination Connector', "SEPCO C23C 3/8\" DIE CAST RX/BX COMBINATION CONNECTOR", "Fittings", "each", "50", "200"),
    ("DEV-WPCOVER", "Weatherproof In-Use Cover, Clear, Single-Gang", "NSI XD110C EXTRA DUTY SINGLE GANG VRT/HRZ WEATHERPROOF CLEAR COVER", "Devices", "each", "5", "20"),
    ("PLATE-2G-DECO", "2-Gang Decora Wall Plate White", "LEV PJ262-W WHITE 2 GANG DECO MIDWAY NYLON WALL PLATE", "Devices", "each", "10", "40"),
    ("DEV-DIMMER-3WY", "Dimmer Switch, SP/3-Way, White (Lutron Diva CL)", "LUT DVCL-153PH-WH SP 3WY DMR", "Devices", "each", "5", "20"),
    ("CTRL-PIRCEIL", "Ceiling PIR Occupancy Sensor, Low Voltage", "SENSOR CM9 12-24 VAC/VDC LOW VOLTAGE WHITE 360 DEGREE CEILING MOUNT PASSIVE INFRARED", "Controls", "each", "5", "20"),
    ("CTRL-PP20", "Occupancy Sensor Power Pack, 120/277V", "SENSOR PP-20 120/277V POWER PACK", "Controls", "each", "5", "20"),
    ("DEV-REC20-DECO", "20A T/R Decora Receptacle White", "LEV T5825-W 20A 125V T/R RCPT DECORA", "Devices", "each", "20", "80"),
    ("DEV-REC20", "20A Duplex Receptacle White", "LEV 16352-1PW 20A WHT RECEPTACLE", "Devices", "each", "10", "40"),
    ("BOX-4SQ-DEEP", '4" Square Box, 2-1/8" Deep', "STLCTY 52171-1/2-3/4-E 4SQ 2-1/8 DEEP BOX", "Boxes", "each", "10", "40"),
    ("BOX-4SQ-GB", '4" Square Box w/Ground Bump', "STLCTY 52151-1/2-3/4EWGB 4\" SQ BOX W/KO AND GROUND BUMP", "Boxes", "each", "10", "40"),
    ("COND-LQT34", '3/4" Liquidtight Flexible Metal Conduit (per ft)', "LQT 3/4\" UL GRAY METAL 100' COIL", "Conduit", "foot", "50", "200"),
    ("FITT-LQTCONN-STR", '3/4" Liquidtight Straight Connector', "SEPCO SLT28T 3/4\" MALLEABLE IRON INSULATED STRAIGHT LIQUIDTITE CONNECTOR", "Fittings", "each", "5", "20"),
    ("FITT-LQTCONN-90", '3/4" Liquidtight 90-Degree Connector', "SEPCO SLT36T 3/4\" MALLEABLE IRON INSULATED 90D LIQUIDTITE CONNECTOR", "Fittings", "each", "5", "20"),
]

# (sku, qty, unit_cost, date "YYYY-MM-DD", ref, note)
RECEIPTS = [
    ("WIRE-12THHN-BK", "1500", "0.2125", "2026-07-28", "S130912211.001", "PO: SOLTERRA -- Maurice Electrical-Timonium"),
    ("WIRE-12THHN-RD", "1500", "0.2125", "2026-07-28", "S130912211.001", "PO: SOLTERRA -- Maurice Electrical-Timonium"),
    ("WIRE-12THHN-BLSTR", "1500", "0.264653", "2026-07-28", "S130912211.001", "PO: SOLTERRA -- Maurice Electrical-Timonium"),
    ("WIRE-12THHN-WH", "1500", "0.2125", "2026-07-28", "S130912211.001", "PO: SOLTERRA -- Maurice Electrical-Timonium"),
    ("WIRE-12THHN-GRN", "1000", "0.2125", "2026-07-28", "S130912211.001", "PO: SOLTERRA -- Maurice Electrical-Timonium"),
    ("LABEL-PCMB3", "1", "18.30", "2026-07-28", "S130912211.001", "PO: SOLTERRA -- Maurice Electrical-Timonium"),
    ("FITT-CADHANGER", "62", "1.069839", "2026-07-28", "S130912211.002", "PO: SOLTERRA -- Maurice Electrical-Timonium"),
    ("WIRE-SEU666", "40", "4.38975", "2026-07-28", "S130916367.001", "PO: 1407 SHOEMAKER -- Maurice Electrical-Timonium"),
    ("FITT-SC1SEC", "2", "1.39", "2026-07-28", "S130916367.001", "PO: 1407 SHOEMAKER -- Maurice Electrical-Timonium"),
    ("DISC-DPU222R", "2", "23.29", "2026-07-28", "S130916367.002", "PO: 1407 SHOEMAKER -- Maurice Electrical-Timonium"),
    ("COND-EMT34", "50", "9.375", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("FITT-EMTCOUP34", "50", "0.4158", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("FITT-EMTCONN34-EA", "25", "0.3964", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("STRAP-EMT34", "200", "0.1526", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("COND-PVC1", "1", "5.72", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("FITT-PVCCAP1", "2", "2.405", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("PLATE-1G-DECO", "33", "0.64", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich (26 + 7 combined, same unit cost)"),
    ("WIRE-18-4C-PLEN", "1000", "0.285", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("FITT-BXDUPLEX38", "100", "1.0511", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("FITT-BXCOMBO38", "100", "0.4223", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("DEV-WPCOVER", "5", "8.91", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("DEV-GFCI20", "12", "19.95", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("PLATE-1G-DUP", "80", "0.61", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("PLATE-2G-DECO", "20", "1.23", "2026-07-27", "S130904332.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("DEV-DIMMER-3WY", "26", "31.50", "2026-07-27", "S130904332.002", "PO: SOLTERRA -- Maurice Electrical-Rich (tagged item)"),
    ("CTRL-PIRCEIL", "30", "69.00", "2026-07-27", "S130904332.002", "PO: SOLTERRA -- Maurice Electrical-Rich (tagged item)"),
    ("CTRL-PP20", "26", "42.00", "2026-07-27", "S130904332.002", "PO: SOLTERRA -- Maurice Electrical-Rich (tagged item)"),
    ("DEV-REC20-DECO", "80", "5.05", "2026-07-27", "S130904332.002", "PO: SOLTERRA -- Maurice Electrical-Rich (tagged item)"),
    ("DEV-REC20", "20", "8.50", "2026-07-27", "S130904332.002", "PO: SOLTERRA -- Maurice Electrical-Rich (tagged item)"),
    ("BOX-4SQ-DEEP", "10", "2.212", "2026-07-27", "S130904332.003", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("BOX-4SQ-GB", "10", "1.89", "2026-07-27", "S130904332.003", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("PLATE-1G-DECO", "80", "0.64", "2026-07-28", "S130904332.004", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("COND-EMT34", "30", "9.805", "2026-07-27", "S130905350.001", "PO: CHURCH -- shipped to 7 Church Lane, Pikesville MD (no job-site location type in this system; received into Shop)"),
    ("FITT-EMTCONN34-EA", "50", "0.3728", "2026-07-27", "S130905350.001", "PO: CHURCH -- Maurice Electrical-Timonium"),
    ("FITT-EMTCOUP34", "25", "0.3912", "2026-07-27", "S130905350.001", "PO: CHURCH -- Maurice Electrical-Timonium"),
    ("COND-LQT34", "100", "2.1809", "2026-07-21", "S130868397.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("FITT-LQTCONN-STR", "6", "3.061667", "2026-07-21", "S130868397.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
    ("FITT-LQTCONN-90", "4", "4.845", "2026-07-21", "S130868397.001", "PO: SOLTERRA -- Maurice Electrical-Rich"),
]

# (sku, qty, date, ref, note) -- ADJUST (from shop), full return of a line
# received in this same batch (S130904332.001), so it nets to zero, no
# negative stock risk.
RETURNS = [
    ("PLATE-1G-DUP", "80", "2026-07-27", "S130912165.001", "Returned to Maurice Electrical Supply -- credit memo S130912165.001 (full return of S130904332.001 line)"),
    ("COND-EMT34", "50", "2026-07-27", "S130912165.001", "Returned to Maurice Electrical Supply -- credit memo S130912165.001 (full return of S130904332.001 line)"),
    ("FITT-EMTCOUP34", "50", "2026-07-27", "S130912165.001", "Returned to Maurice Electrical Supply -- credit memo S130912165.001 (full return of S130904332.001 line)"),
    ("STRAP-EMT34", "200", "2026-07-27", "S130912165.001", "Returned to Maurice Electrical Supply -- credit memo S130912165.001 (full return of S130904332.001 line)"),
]


def dt(date_str: str) -> datetime:
    return datetime.strptime(date_str, "%Y-%m-%d").replace(hour=12)


def main() -> None:
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        vendor = db.query(Vendor).filter(Vendor.name == VENDOR_NAME).first()
        if not vendor:
            vendor = Vendor(name=VENDOR_NAME, active=True)
            db.add(vendor)
            db.flush()
            print(f"Created vendor: {VENDOR_NAME}")

        admin = db.query(User).filter(User.role == "admin").first()
        if not admin:
            raise SystemExit("No admin user found -- run scripts/seed.py first")

        shop = db.query(Location).filter(Location.type == "shop").first()
        if not shop:
            raise SystemExit("No shop location found -- run scripts/seed.py first")

        created_items = 0
        for sku, name, desc, category, unit, rp, rq in NEW_ITEMS:
            if db.query(Item).filter(Item.sku == sku).first():
                continue
            db.add(Item(
                sku=sku, barcode=sku, name=name, description=desc, category=category,
                unit=unit, avg_cost=Decimal("0"), last_cost=Decimal("0"),
                reorder_point=Decimal(rp), reorder_qty=Decimal(rq), active=True,
            ))
            created_items += 1
        db.flush()
        print(f"Created {created_items} new items ({len(NEW_ITEMS) - created_items} already existed)")

        receive_count = 0
        for sku, qty, cost, date_str, ref, note in RECEIPTS:
            item = db.query(Item).filter(Item.sku == sku).first()
            if not item:
                raise SystemExit(f"Item {sku} not found -- add it to NEW_ITEMS")
            txn = apply_transaction(
                db, type="RECEIVE", item_id=item.id, qty=Decimal(qty), user=admin,
                vendor_id=vendor.id, unit_cost=Decimal(cost),
                to_location_id=shop.id, ref=ref, note=note,
            )
            when = dt(date_str)
            txn.created_at = when
            txn.updated_at = when
            receive_count += 1
        db.commit()
        print(f"Applied {receive_count} RECEIVE transactions")

        return_count = 0
        for sku, qty, date_str, ref, note in RETURNS:
            item = db.query(Item).filter(Item.sku == sku).first()
            txn = apply_transaction(
                db, type="ADJUST", item_id=item.id, qty=Decimal(qty), user=admin,
                from_location_id=shop.id, reason="other", ref=ref, note=note,
            )
            when = dt(date_str)
            txn.created_at = when
            txn.updated_at = when
            return_count += 1
        db.commit()
        print(f"Applied {return_count} ADJUST (return) transactions")

        print("\nSkipped on purpose:")
        print("  S130917434.001 -- $216.94 AR/late-fee service charge (not material)")
        print("  S130905443.001 -- -$1186.18 return referencing orders outside this batch")
        print("  S130902486.001 -- -$201.50 return referencing orders outside this batch")
        print("  S130879813.001 -- -$518.91 return referencing orders outside this batch")
    finally:
        db.close()


if __name__ == "__main__":
    main()
