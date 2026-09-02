"""One-time migration: copy all real data from a local SQLite export into the
production Postgres database, preserving primary keys so every foreign key
(transactions -> items/locations/jobs/users/vendors) still lines up.

Run INSIDE the api container, which already has DATABASE_URL pointed at
Postgres. The SQLite source file must be at /tmp/source.db in the container.

Wipes existing rows in the destination tables first (the prod DB only has
the minimal go-live seed at this point), then copies everything from SQLite,
then restores the admin login's email/password chosen at go-live time, then
fixes Postgres auto-increment sequences so future inserts don't collide.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import engine as pg_engine
from app.models import (
    Item, Job, LoginEvent, Location, StockLevel, Transaction, Truck, User, Vendor,
)

SQLITE_PATH = "/tmp/source.db"

# Parent-first order (respects FKs) for copying; reverse of this for wiping.
MODELS = [User, Truck, Location, Vendor, Item, StockLevel, Job, Transaction, LoginEvent]


def main():
    sqlite_engine = create_engine(f"sqlite:///{SQLITE_PATH}", connect_args={"check_same_thread": False})
    SqliteSession = sessionmaker(bind=sqlite_engine)
    PgSession = sessionmaker(bind=pg_engine)

    src = SqliteSession()
    dst = PgSession()

    # Keep the admin login that was set at go-live time -- don't clobber it
    # with whatever the local dev admin's email/password happened to be.
    prod_admin = dst.query(User).filter(User.role == "admin").first()
    prod_admin_email = prod_admin.email if prod_admin else None
    prod_admin_password_hash = prod_admin.password_hash if prod_admin else None
    if not prod_admin_email:
        print("ERROR: no existing admin user found in prod DB -- aborting.", file=sys.stderr)
        sys.exit(1)

    try:
        # Wipe destination in reverse dependency order.
        for model in reversed(MODELS):
            dst.query(model).delete()
        dst.commit()

        # Copy every row from sqlite, preserving explicit primary keys.
        for model in MODELS:
            rows = src.query(model).all()
            for row in rows:
                cols = {c.name: getattr(row, c.name) for c in model.__table__.columns}
                dst.execute(model.__table__.insert().values(**cols))
            dst.commit()
            print(f"{model.__tablename__}: copied {len(rows)} rows")

        # Restore the production admin's real login (name/role come from the
        # migrated row; email/password stay whatever was set at go-live).
        migrated_admin = dst.query(User).filter(User.role == "admin").first()
        if migrated_admin:
            migrated_admin.email = prod_admin_email
            migrated_admin.password_hash = prod_admin_password_hash
            dst.commit()
            print(f"Restored admin login as {prod_admin_email}")

        # Fix sequences so the next auto-increment insert doesn't collide.
        for model in MODELS:
            table = model.__tablename__
            dst.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table}), 1), "
                f"(SELECT MAX(id) FROM {table}) IS NOT NULL)"
            ))
        dst.commit()
        print("Sequences reset. Migration complete.")
    finally:
        src.close()
        dst.close()


if __name__ == "__main__":
    main()
