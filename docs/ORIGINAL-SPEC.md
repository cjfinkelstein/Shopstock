# Claude Code Build Prompt — Electrical Contractor Inventory & Material Sign-Out App

## How to execute this build
- Build the complete, working application described below. No stubs, no TODOs, no "left as an exercise." Every screen and endpoint functional.
- Work through the Phases in order. At the end of each phase, run the app (backend + frontend) and verify that phase works before moving on.
- Do not ask clarifying questions. Where this spec is silent, make the reasonable call consistent with the spec and log it in a `DECISIONS.md`.
- Write a `README.md` covering local dev, docker deploy on a VPS, and nightly `pg_dump` backup.
- App name placeholder: **ShopStock** — keep it configurable (single constant / env var).

## Project overview
Internal inventory app for a small electrical contractor: 1 admin (owner/purchaser) and 7 field techs. Admin buys materials in bulk into shop stock. Techs sign materials out to jobs — from the shop or from their assigned truck — by scanning QR labels with their phone camera. Every sign-out is tagged to a job so material cost can be recovered on billing. Costs are tracked (moving average) but **never shown to techs**. Mobile-first PWA; admin screens also comfortable on desktop.

## Stack
- **Backend:** FastAPI, SQLAlchemy 2.0, Pydantic v2, PostgreSQL 16, Alembic migrations
- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS, mobile-first, installable PWA (manifest + service worker for app-shell caching only — **no offline data sync in v1**)
- **Scanning:** `html5-qrcode` for camera QR scanning (works on iOS Safari and Android Chrome — do NOT rely on the native BarcodeDetector API, iOS doesn't support it)
- **QR generation:** `qrcode` (JS) client-side for label sheets
- **Deploy:** `docker-compose.yml` with services: `db` (postgres + volume), `api`, `web` (nginx serving the Vite build, proxying `/api` to the api service). Single cheap VPS target.
- **Time:** store UTC, display America/New_York.

## Auth model
- **Tech login:** tap-your-name screen — a grid of big name buttons. Tapping a name starts a 12h session (JWT). No password. Optional per-user 4-digit PIN that admin can enable per tech (default OFF for everyone).
- **Admin login:** email + password (bcrypt), link at the bottom of the tap screen.
- **Roles:** `tech`, `admin`. Techs can scan, sign out, return, transfer, and view stock. Admin can do everything. **Cost fields must be stripped from tech-facing API responses server-side**, not just hidden in the UI.

## Data model (Postgres)
All tables get `created_at` / `updated_at`. Soft-delete via `active` flags everywhere — never hard-delete rows that have history.

- **users:** id, name, role(`tech`|`admin`), pin_hash nullable, email nullable, password_hash nullable, active
- **trucks:** id, name (e.g. "Truck 3"), assigned_user_id FK nullable, active
- **locations:** id, type(`shop`|`truck`), truck_id FK nullable, name. Exactly one shop location seeded; creating a truck auto-creates its location.
- **vendors:** id, name, active
- **items:** id, sku unique, barcode (defaults to sku), name, description, category, unit(`each`|`box`|`foot`), avg_cost numeric(10,4), last_cost numeric(10,4), reorder_point numeric(12,2), reorder_qty numeric(12,2), active, notes
- **stock_levels:** item_id, location_id, qty numeric(12,2), unique(item_id, location_id)
- **jobs:** id, job_number unique, name, customer, address, status(`active`|`closed`)
- **transactions (the ledger — source of truth):** id, type(`RECEIVE`|`SIGN_OUT`|`RETURN`|`TRANSFER`|`ADJUST`), item_id, qty numeric(12,2) always positive (direction comes from from/to), from_location_id nullable, to_location_id nullable, job_id nullable, user_id, vendor_id nullable, unit_cost numeric(10,4) snapshot, ref (PO/receipt no.), note, reason nullable (`count_correction`|`damaged`|`lost`|`other` — ADJUST only), went_negative bool default false

### Ledger rules (get these exactly right)
1. Every stock change writes a transaction row AND updates `stock_levels` inside the same DB transaction. The ledger must always reconcile to stock_levels; ship a `scripts/check_consistency.py` that proves it.
2. **RECEIVE:** vendor + unit_cost required, lands in shop (location selectable, defaults shop). Updates moving average across ALL locations: `avg_cost = (total_qty_all_locations * avg_cost + qty * unit_cost) / (total_qty_all_locations + qty)`. Sets `last_cost`. If total on hand is zero or negative, avg_cost = unit_cost.
3. **SIGN_OUT:** from a location → to a job (`job_id` required, `to_location_id` null). Snapshots `unit_cost = current avg_cost`. This is the row that drives job costing.
4. **RETURN:** job → location, costed at current avg_cost snapshot.
5. **TRANSFER:** location → location (shop↔truck, truck↔truck). No job, no cost impact.
6. **ADJUST:** admin only. Signed effect via from/to (increase = to location, decrease = from location), reason required, note required.
7. **Quantity validation:** integers only for `each`/`box` items; up to 2 decimals for `foot` items.
8. **Negative stock:** ALLOW it (field reality beats hard blocks) but set `went_negative=true` on the transaction and surface those items on the admin dashboard as "recount needed."

## API (FastAPI, prefix `/api/v1`, OpenAPI docs at `/api/docs`)
- **Auth:** `POST /auth/tap` (user_id, pin optional), `POST /auth/login` (admin), `GET /auth/me`, `POST /auth/logout`
- **Users:** admin CRUD; `GET /users/techs` returns active tech names/ids only (unauthenticated — powers the tap screen)
- **Trucks / Vendors:** admin CRUD
- **Items:** admin CRUD; `GET /items?search=&category=&low_stock=true`; `GET /items/by-barcode/{code}`; `GET /items/{id}/stock` (qty per location); `GET /items/{id}/history` (paged transactions)
- **Labels:** `POST /labels/print` with `item_ids[]` → print-ready HTML page: Avery 5160 grid (3 × 10 per sheet, 2.625" × 1"), each label = QR (encodes the barcode string) + SKU + item name. Browser print, no special hardware.
- **Jobs:** CRUD; `GET /jobs?status=active&search=`; `GET /jobs/{id}/materials` (itemized usage + total cost — the billing recovery view)
- **Transactions:** `POST /transactions/receive`, `/sign-out`, `/return`, `/transfer`, `/adjust`; batch endpoints `POST /transactions/sign-out/batch` and `/transfer/batch` (many items, one job/destination — powers cart + truck loading); `GET /transactions` with filters (type, item, job, user, location, date range)
- **Stock:** `GET /stock?location_id=`; `GET /stock/valuation` (admin, qty × avg_cost by location)
- **Reports (admin, all support `&format=csv`):** `GET /reports/reorder` (shop qty ≤ reorder_point, suggested = reorder_qty, grouped by category), `GET /reports/usage-by-tech?from&to`, `GET /reports/usage-by-job?from&to&job_id=`, `GET /reports/adjustments?from&to`
- **Dashboards:** `GET /dashboard/admin` (low-stock count, went-negative items, today's activity, total inventory value), `GET /dashboard/tech` (my last 10 transactions, my truck summary)

## Frontend screens
Bottom tab nav for techs: **Home · Scan · Search · My Truck · Activity**. Admin gets those plus a sidebar/menu on desktop: **Dashboard · Items · Receive · Jobs · Reports · Settings**.

1. **Tap-in:** grid of big name buttons (56px+ tall), initials avatars. "Admin login" link at bottom.
2. **Tech Home:** one giant Scan button, then Search, My Truck, and last 10 transactions.
3. **Scan:** full-screen camera with target reticle → decode QR → item sheet. Unknown code → "Not found" with a search fallback.
4. **Item sheet:** name, category, on-hand at Shop and My Truck (no costs). Actions: **Sign Out**, **Return**, **Transfer**.
   - Sign-out flow: qty pad (whole numbers for each/box; foot items get quick chips **+25 / +50 / +100 / +250 ft** plus manual entry) → job picker (5 most recent jobs first, then searchable list) → source toggle (defaults to My Truck if it has ≥ qty, else Shop) → Confirm. Success = big green check + auto-return to Scan for the next item.
   - Return reverses it (job picker → destination).
5. **Cart / Load Truck mode:** scan multiple items into a cart, edit qtys, then either sign the whole cart out to ONE job or transfer it all shop → my truck (morning loading). One confirm.
6. **Search:** text + category chips → item sheet.
7. **My Truck:** live list of items/qtys on my truck; tap → item sheet.
8. **Admin Dashboard:** low-stock list, "went negative — recount" list, today's sign-outs, inventory value by location.
9. **Items (admin):** table w/ search, create/edit (all fields incl. reorder point/qty), multi-select → **Print Labels**.
10. **Receive (admin):** vendor picker, scan or search to add lines, qty + unit cost per line, ref/PO field, submit once.
11. **Jobs (admin):** CRUD, close job, job detail = materials list with qty × snapshot cost, job total, CSV export.
12. **Reports (admin):** the four reports with date-range pickers and CSV download.
13. **Settings (admin):** users (add tech, toggle PIN), trucks (create/assign), vendors, categories.

## UI direction
Clean and modern, high contrast, zero clutter. Minimum 48px touch targets, primary actions in thumb reach, usable one-handed with gloves. System font stack or Inter. Light default with dark-mode support. Instant visual feedback on every action; optimistic UI on sign-outs with rollback on API failure. Techs see only what they need — no costs, no admin chrome.

## Seed data (ship a `scripts/seed.py`)
- Admin: `admin@shopstock.local` / `changeme123`
- Techs: Mike, Dave, Carlos, Tony, James, Pete, Sam — Trucks 1–7 created and assigned respectively
- Locations: Shop + the 7 truck locations
- Vendors: City Electric Supply, Home Depot Pro
- Jobs: 3 samples (e.g. JOB-1001 "Colfax Ave Panel Upgrade", JOB-1002 "Reisterstown Rd TI", JOB-1003 "Service Calls — July")
- ~20 realistic items with plausible costs and reorder points, covering every unit type. Examples:
  - foot: 12/2 Romex NM-B, 14/2 Romex NM-B, 12 AWG THHN Black, 12 AWG THHN White, 3/4" ENT
  - each: 3/4" EMT 10' stick, 4" square box, single-gang old-work box, duplex receptacle 15A, GFCI receptacle 20A, single-pole switch, 20A 1-pole breaker (Square D QO), 8' ground rod
  - box: wire nuts (yellow, 100ct), 3/4" EMT set-screw connectors (50ct), NM staples (100ct), 1/4" EZ anchors (100ct)
- Opening stock loaded via real RECEIVE transactions (not raw inserts) so the ledger reconciles from day one. Put some stock on 2–3 trucks via TRANSFER transactions too.

## Phases — build in order, verify each
1. **Scaffold:** repo layout (`/api`, `/web`, `docker-compose.yml`), Postgres up, Alembic init + first migration, `/api/v1/health`, Vite app boots with Tailwind.
2. **Auth + users + trucks + locations:** tap flow, admin login, role guard middleware, cost-stripping for tech responses.
3. **Items + vendors + stock + labels:** CRUD, barcode lookup, per-location stock, label print page renders and QRs scan from a phone.
4. **Transactions engine:** all 5 types + batch endpoints, moving-average math, went-negative flagging. **Unit-test the avg-cost formula and ledger↔stock_levels consistency** (pytest).
5. **Jobs + job costing:** job materials view with totals.
6. **Tech UI:** tap-in → scan → item sheet → sign-out/return/transfer, cart mode, My Truck, Search, Activity.
7. **Admin UI:** dashboard, items, receive, jobs, reports with CSV.
8. **Ship:** PWA manifest + icons + install prompt, seed script, `README.md`, `DECISIONS.md`, consistency-check script.

## Acceptance checklist — verify every line before calling it done
- [ ] `docker compose up` → app on :80, API docs at `/api/docs`, seed script run
- [ ] Tap "Mike" → open the printed label page on screen → scan a QR with a phone (or simulated camera input) → sign out 50 ft of 12/2 Romex to JOB-1001 in ≤4 taps after the scan
- [ ] Shop qty dropped by 50; JOB-1001 materials view shows 50 ft at the avg cost snapshot
- [ ] Receive 250 ft of 12/2 at a different unit cost → avg_cost updates per the formula (unit test proves it)
- [ ] Transfer 100 ft shop → Truck 3 → shows in Carlos's My Truck; sign-out source defaults to My Truck
- [ ] Return 20 ft from JOB-1001 back to shop; ADJUST −10 ft reason `damaged` logs with note
- [ ] Sign out more than on-hand → succeeds, transaction flagged, item appears in admin "recount needed"
- [ ] Reorder report lists items at/below reorder point with suggested qty; CSV downloads
- [ ] Usage-by-tech and usage-by-job totals are correct for the seeded activity; CSVs download
- [ ] Logged in as a tech, no cost appears anywhere — including raw API responses
- [ ] `scripts/check_consistency.py` passes: ledger sums == stock_levels for every item/location
