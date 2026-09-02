"""Seed data for ShopStock. Idempotent: refuses to run twice.

Opening stock is loaded via real RECEIVE transactions (and truck stock via
TRANSFER) so the ledger reconciles to stock_levels from day one.

Run from the api/ directory (or the api container):  python scripts/seed.py

Go-live mode:  python scripts/seed.py --minimal
    Creates only the admin, the Shop, the techs + their trucks, and the two
    supplier vendors — no demo items, stock, jobs, or transactions. Admin
    credentials come from ADMIN_EMAIL / ADMIN_PASSWORD env vars when set.
"""

import argparse
import os
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import hash_secret
from app.database import SessionLocal, engine, Base
from app.models import Job, Location, Truck, User, Vendor, Item
from app.services.ledger import apply_transaction

TECHS = ["Ed", "Ray", "Avigdor", "Sam", "Shui", "Al", "CJ"]

ITEMS = [
    # (sku, name, category, unit, cost, reorder_point, reorder_qty)
    ("WIRE-122NM", "12/2 Romex NM-B (per ft)", "Wire", "foot", "0.85", "250", "1000"),
    ("WIRE-142NM", "14/2 Romex NM-B (per ft)", "Wire", "foot", "0.62", "250", "1000"),
    ("WIRE-12THHN-BK", "12 AWG THHN Black (per ft)", "Wire", "foot", "0.22", "500", "2500"),
    ("WIRE-12THHN-WH", "12 AWG THHN White (per ft)", "Wire", "foot", "0.22", "500", "2500"),
    ("COND-ENT34", '3/4" ENT Smurf Tube (per ft)', "Conduit", "foot", "0.55", "100", "500"),
    ("COND-EMT34", '3/4" EMT 10\' Stick', "Conduit", "each", "9.85", "20", "50"),
    ("BOX-4SQ", '4" Square Box 1-1/2" Deep', "Boxes", "each", "1.95", "30", "100"),
    ("BOX-1G-OW", "Single-Gang Old-Work Box", "Boxes", "each", "1.35", "30", "100"),
    ("DEV-REC15", "Duplex Receptacle 15A TR White", "Devices", "each", "1.85", "40", "100"),
    ("DEV-GFCI20", "GFCI Receptacle 20A White", "Devices", "each", "16.50", "10", "30"),
    ("DEV-SW1P", "Single-Pole Switch 15A White", "Devices", "each", "1.45", "40", "100"),
    ("BRKR-QO120", "20A 1-Pole Breaker Square D QO", "Breakers", "each", "12.75", "10", "24"),
    ("GRND-ROD8", "8' Ground Rod 5/8\"", "Grounding", "each", "18.90", "6", "12"),
    ("PLATE-1G-DUP", "1-Gang Duplex Wall Plate White", "Devices", "each", "0.45", "50", "200"),
    ("STRAP-EMT34", '3/4" EMT 1-Hole Strap', "Fittings", "each", "0.28", "100", "300"),
    ("WN-YEL100", "Wire Nuts Yellow (100 ct box)", "Consumables", "box", "8.95", "5", "12"),
    ("CONN-EMT34-50", '3/4" EMT Set-Screw Connectors (50 ct box)', "Fittings", "box", "42.00", "3", "6"),
    ("STAPLE-NM100", "NM Cable Staples (100 ct box)", "Consumables", "box", "4.75", "5", "12"),
    ("ANCH-EZ100", '1/4" EZ Anchors (100 ct box)', "Consumables", "box", "11.50", "3", "8"),
    ("TAPE-ELEC", 'Electrical Tape 3/4" Black', "Consumables", "each", "2.25", "20", "60"),
]

# (sku, qty) received into shop at seed time
OPENING_STOCK = {
    "WIRE-122NM": "1000", "WIRE-142NM": "1000", "WIRE-12THHN-BK": "2500",
    "WIRE-12THHN-WH": "2500", "COND-ENT34": "500", "COND-EMT34": "60",
    "BOX-4SQ": "120", "BOX-1G-OW": "80", "DEV-REC15": "150", "DEV-GFCI20": "40",
    "DEV-SW1P": "120", "BRKR-QO120": "30", "GRND-ROD8": "12", "PLATE-1G-DUP": "200",
    "STRAP-EMT34": "300", "WN-YEL100": "15", "CONN-EMT34-50": "8",
    "STAPLE-NM100": "12", "ANCH-EZ100": "10", "TAPE-ELEC": "48",
}

# truck name -> {sku: qty} loaded via TRANSFER after receiving
TRUCK_STOCK = {
    "Truck 1": {"WIRE-122NM": "250", "DEV-REC15": "20", "WN-YEL100": "2", "TAPE-ELEC": "4"},
    "Truck 3": {"WIRE-122NM": "150", "WIRE-142NM": "200", "BOX-1G-OW": "10", "DEV-SW1P": "15"},
    "Truck 5": {"COND-EMT34": "10", "CONN-EMT34-50": "1", "STRAP-EMT34": "40", "BOX-4SQ": "20"},
}

JOBS = [
    ("JOB-1001", "Colfax Ave Panel Upgrade", "Hendricks Property Group", "418 Colfax Ave"),
    ("JOB-1002", "Reisterstown Rd TI", "Bright Path Dental", "6810 Reisterstown Rd"),
    ("JOB-1003", "Service Calls — July 2026", "Various", ""),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the ShopStock database.")
    parser.add_argument("--minimal", action="store_true",
                        help="go-live seed: users/trucks/vendors only, no demo data")
    args = parser.parse_args()

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@shopstock.local")
    admin_password = os.environ.get("ADMIN_PASSWORD", "changeme123")

    Base.metadata.create_all(engine)  # no-op when alembic already ran
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            print("Database already has users — refusing to reseed.")
            return

        admin = User(name="Admin", role="admin", email=admin_email,
                     password_hash=hash_secret(admin_password), active=True)
        db.add(admin)

        shop = Location(type="shop", name="Shop", active=True)
        db.add(shop)
        db.flush()

        truck_locs: dict[str, Location] = {}
        for i, name in enumerate(TECHS, start=1):
            tech = User(name=name, role="tech", active=True)
            db.add(tech)
            db.flush()
            truck = Truck(name=f"Truck {i}", assigned_user_id=tech.id, active=True)
            db.add(truck)
            db.flush()
            loc = Location(type="truck", truck_id=truck.id, name=truck.name, active=True)
            db.add(loc)
            db.flush()
            truck_locs[truck.name] = loc

        vendors = [Vendor(name="City Electric Supply", active=True),
                   Vendor(name="Home Depot Pro", active=True)]
        db.add_all(vendors)

        if args.minimal:
            db.commit()
            print(f"Go-live seed: 1 admin, {len(TECHS)} techs, {len(TECHS)} trucks, "
                  f"Shop location, {len(vendors)} vendors. No demo data.")
            print(f"Admin login: {admin_email} / (the password you set)")
            return

        for number, name, customer, address in JOBS:
            db.add(Job(job_number=number, name=name, customer=customer,
                       address=address, status="active"))

        items: dict[str, Item] = {}
        for sku, name, category, unit, cost, rp, rq in ITEMS:
            item = Item(sku=sku, barcode=sku, name=name, category=category, unit=unit,
                        avg_cost=Decimal("0"), last_cost=Decimal("0"),
                        reorder_point=Decimal(rp), reorder_qty=Decimal(rq), active=True)
            db.add(item)
            items[sku] = item
        db.flush()

        # Opening stock via real RECEIVE transactions — the ledger is born reconciled.
        cost_by_sku = {row[0]: Decimal(row[4]) for row in ITEMS}
        ces = vendors[0]
        for sku, qty in OPENING_STOCK.items():
            apply_transaction(
                db, type="RECEIVE", item_id=items[sku].id, qty=Decimal(qty), user=admin,
                vendor_id=ces.id, unit_cost=cost_by_sku[sku],
                to_location_id=shop.id, ref="OPENING", note="Opening stock count",
            )

        # Load a few trucks via TRANSFER
        for truck_name, lines in TRUCK_STOCK.items():
            loc = truck_locs[truck_name]
            for sku, qty in lines.items():
                apply_transaction(
                    db, type="TRANSFER", item_id=items[sku].id, qty=Decimal(qty), user=admin,
                    from_location_id=shop.id, to_location_id=loc.id, note="Initial truck load",
                )

        db.commit()
        print(f"Seeded: 1 admin, {len(TECHS)} techs, {len(TECHS)} trucks, "
              f"{len(ITEMS)} items, {len(JOBS)} jobs, opening stock via ledger.")
        print("Admin login: admin@shopstock.local / changeme123")
    finally:
        db.close()


if __name__ == "__main__":
    main()
