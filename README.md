# APEX Electrical Stock — Inventory & Material Sign-Out

Internal inventory app for a small electrical contractor: one admin (owner/purchaser)
and seven field techs. Admin buys material in bulk into shop stock; techs sign material
out to jobs — from the shop or their truck — by **finding items on their phone**
(fast search, category browse, recently-used shortcuts; no barcode scanners).
Every sign-out is job-tagged so material cost is recovered at billing. Costs are tracked
(moving average) and **never shown to techs** — cost fields are stripped from tech API
responses server-side.

| Piece | Stack |
| --- | --- |
| API | FastAPI · SQLAlchemy 2.0 · Pydantic v2 · PostgreSQL 16 · Alembic |
| Web | React 18 + TypeScript + Vite · Tailwind CSS · installable PWA |
| Labels | Optional Avery 5160 shelf-label sheets (admin, browser print) |
| Deploy | `docker-compose` (db + api + nginx web) on a single VPS |

The app name is configurable: set `APP_NAME` in the environment.

---

## Local development

Prereqs: Python 3.12+ and Node 20+. No local Postgres needed — with no
`DATABASE_URL` set, the API falls back to SQLite (`api/shopstock.db`), which is
supported for dev/tests. Production always runs Postgres.

### API

```bash
cd api
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head            # create the schema
python scripts/seed.py          # admin + techs + trucks + items + opening stock
uvicorn app.main:app --reload --port 8000
```

- OpenAPI docs: <http://localhost:8000/api/docs>
- Admin login: `admin@shopstock.local` / `changeme123` (change it!)

### Web

```bash
cd web
npm install
npm run dev                     # http://localhost:5173, proxies /api -> :8000
```

### Tests & consistency check

```bash
cd api
python -m pytest tests -q                 # ledger math, avg-cost formula, cost stripping
python scripts/check_consistency.py       # proves ledger == stock_levels everywhere
```

---

## Deploying on a VPS (Docker)

Any cheap VPS with Docker + Compose v2 works (1 GB RAM is plenty).

```bash
git clone <your-repo> shopstock && cd shopstock
cp .env.example .env
# edit .env:
#   JWT_SECRET  -> openssl rand -hex 32
#   POSTGRES_PASSWORD -> something real
docker compose up -d --build
docker compose exec api python scripts/seed.py
```

The app is now on port **80** (`http://your-vps/`), API docs at `/api/docs`.

- The `api` container runs `alembic upgrade head` on every boot, so schema
  migrations apply automatically on deploys.
- Put a TLS proxy (Caddy, Traefik, or nginx + certbot) in front for HTTPS —
  required for installing the PWA to phone home screens.

### Updating

```bash
git pull
docker compose up -d --build
```

---

## Nightly backups (pg_dump)

On the VPS, as the user that owns the compose project:

```bash
mkdir -p /var/backups/shopstock
crontab -e
```

Add:

```cron
0 3 * * * cd /path/to/shopstock && docker compose exec -T db pg_dump -U shopstock shopstock | gzip > /var/backups/shopstock/shopstock-$(date +\%F).sql.gz && find /var/backups/shopstock -name '*.sql.gz' -mtime +30 -delete
```

That takes a compressed dump at 3:00 AM daily and prunes dumps older than 30 days.

**Restore:**

```bash
gunzip -c /var/backups/shopstock/shopstock-2026-07-24.sql.gz | docker compose exec -T db psql -U shopstock shopstock
```

Copy the dumps off-box too (rsync/rclone to object storage) — a backup on the
same disk as the database is only half a backup.

---

## Using the app

- **Techs:** open the site → tap your name (optional 4-digit PIN if the admin enabled
  it for you) → 12-hour session. Hit **Find** → search or browse categories (your
  recently-used items are one tap away) → sign out to a job in a few taps. The cart
  batches many items into one job sign-out or a morning shop→truck load. "My Truck"
  shows live truck stock.
- **Admin:** email + password login (link at the bottom of the tap screen). Dashboard
  (low stock, negative-stock recounts, today's activity, inventory value), item CRUD +
  Avery 5160 label printing, receiving with per-line costs, jobs with material cost
  totals + CSV, four reports (reorder, usage by tech, usage by job, adjustments — all
  CSV-exportable), and settings (techs, PINs, trucks, vendors).
- **Install on phones:** the site is a PWA — "Add to Home Screen" on iOS Safari, or
  the install prompt on Android Chrome. App-shell only; live data still needs signal
  (no offline sync in v1).

## Ledger model (how stock stays honest)

Every stock change is a row in `transactions` (RECEIVE / SIGN_OUT / RETURN /
TRANSFER / ADJUST) written in the same DB transaction as the `stock_levels`
update, so the ledger always reconciles — `scripts/check_consistency.py` proves
it. Sign-outs snapshot the item's moving-average cost at that moment, which is
what job costing bills from; later price changes never rewrite history. Negative
stock is allowed (field reality wins) but flagged, and flagged items appear on
the admin dashboard as "recount needed" until a count-correction adjustment clears
them.
