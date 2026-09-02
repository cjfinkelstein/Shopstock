import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite://"  # in-memory; each test session isolated

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.database as database
from app.database import Base


@pytest.fixture()
def db_session(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", TestSession)
    session = TestSession()
    yield session
    session.close()


@pytest.fixture()
def client(db_session):
    from app.database import get_db
    from app.main import app

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def seeded(db_session):
    """Minimal world: admin, one tech w/ truck, shop, vendor, job, three items."""
    from decimal import Decimal

    from app.auth import hash_secret
    from app.models import Item, Job, Location, Truck, User, Vendor

    admin = User(name="Admin", role="admin", email="admin@test.local",
                 password_hash=hash_secret("pw"), active=True)
    tech = User(name="Mike", role="tech", active=True)
    db_session.add_all([admin, tech])
    shop = Location(type="shop", name="Shop", active=True)
    db_session.add(shop)
    db_session.flush()
    truck = Truck(name="Truck 1", assigned_user_id=tech.id, active=True)
    db_session.add(truck)
    db_session.flush()
    truck_loc = Location(type="truck", truck_id=truck.id, name="Truck 1", active=True)
    vendor = Vendor(name="City Electric", active=True)
    job = Job(job_number="JOB-1", name="Test Job", status="active")
    romex = Item(sku="WIRE-122NM", barcode="WIRE-122NM", name="12/2 Romex", category="Wire",
                 unit="foot", avg_cost=Decimal("0"), last_cost=Decimal("0"),
                 reorder_point=Decimal("100"), reorder_qty=Decimal("500"), active=True)
    box = Item(sku="BOX-4SQ", barcode="BOX-4SQ", name="4in Square Box", category="Boxes",
               unit="each", avg_cost=Decimal("0"), last_cost=Decimal("0"),
               reorder_point=Decimal("10"), reorder_qty=Decimal("50"), active=True)
    nuts = Item(sku="WN-100", barcode="WN-100", name="Wire Nuts 100ct", category="Consumables",
                unit="box", avg_cost=Decimal("0"), last_cost=Decimal("0"),
                reorder_point=Decimal("2"), reorder_qty=Decimal("10"), active=True)
    db_session.add_all([truck_loc, vendor, job, romex, box, nuts])
    db_session.commit()
    return {
        "admin": admin, "tech": tech, "shop": shop, "truck_loc": truck_loc,
        "vendor": vendor, "job": job, "romex": romex, "box": box, "nuts": nuts,
    }


def ledger_reconciles(db) -> bool:
    """Same check as scripts/check_consistency.py, inline for tests."""
    from decimal import Decimal

    from sqlalchemy import select

    from app.models import StockLevel, Transaction

    ledger: dict = {}
    for t in db.scalars(select(Transaction)).all():
        qty = Decimal(str(t.qty))
        if t.from_location_id is not None:
            k = (t.item_id, t.from_location_id)
            ledger[k] = ledger.get(k, Decimal("0")) - qty
        if t.to_location_id is not None:
            k = (t.item_id, t.to_location_id)
            ledger[k] = ledger.get(k, Decimal("0")) + qty
    stock = {(s.item_id, s.location_id): Decimal(str(s.qty))
             for s in db.scalars(select(StockLevel)).all()}
    keys = set(ledger) | set(stock)
    exp = Decimal("0.01")
    return all(ledger.get(k, Decimal("0")).quantize(exp) == stock.get(k, Decimal("0")).quantize(exp)
               for k in keys)
