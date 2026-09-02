# APEX Electrical Stock — project context for Claude Code

Internal inventory + material sign-out app for a small electrical contractor
(1 admin/owner, 7 field techs: Ed, Ray, Avigdor, Sam, Shui, Al, CJ with
Trucks 1–7). Techs **find** items on their phone (search / category browse /
recently-used — there is **no barcode scanning**; it was removed on purpose)
and sign material out to jobs so cost is recovered at billing. Costs are
tracked by moving average and **never shown to techs** — stripped server-side.
Mobile-first installable PWA; admin also used on desktop.

Read `DECISIONS.md` for every product decision and pivot, `HANDOFF.md` for
setup-from-zip and project history, `GO-LIVE.md` for deployment,
`docs/ORIGINAL-SPEC.md` for the original build spec (parts about QR scanning
are superseded — see DECISIONS #26–28).

## Stack & layout

- `api/` — FastAPI + SQLAlchemy 2.0 + Pydantic v2 + Alembic. Postgres 16 in
  production (docker), **SQLite locally** (`api/shopstock.db`, auto-created;
  `DATABASE_URL` env overrides). Routers in `app/routers/`, ledger engine in
  `app/services/ledger.py`, cost-stripping via tech vs admin response schemas
  in `app/schemas.py`.
- `web/` — React 18 + TS + Vite + Tailwind. Pages `src/pages/{,tech/,admin/}`,
  shared components `src/components/`, design contract **`web/DESIGN.md` —
  read it before ANY UI work** (v3 "vivid & friendly": white canvas, vivid
  gradient stat tiles, Nunito display font, icon discs, catTint category
  colors).
- Root: `docker-compose.yml` (db+api+web/nginx), `.env.example`, `GO-LIVE.md`.

## Commands (Windows dev)

```bash
# api (from api/): first time: python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
.venv/Scripts/python.exe scripts/seed.py            # full demo seed (refuses to rerun)
.venv/Scripts/python.exe scripts/seed.py --minimal  # go-live: crew+shop only, admin creds from ADMIN_EMAIL/ADMIN_PASSWORD
.venv/Scripts/python.exe -m pytest tests -q         # 30 tests
.venv/Scripts/python.exe scripts/check_consistency.py  # ledger == stock_levels, must always pass

# web (from web/)
npm run dev        # vite :5173, proxies /api -> localhost:8000
npx tsc --noEmit   # typecheck
npm run build      # production build
```

`.claude/launch.json` defines the `shopstock-web` preview server for the
browser pane. Demo admin: `admin@shopstock.local` / `changeme123`. Tech login
is tap-a-name (`POST /auth/tap {user_id}`), Avigdor is user_id 4 in demo data.

## Invariants — do not break

1. **Every stock change goes through `apply_transaction`** (ledger row +
   `stock_levels` update in the same DB transaction). Never write stock
   directly. `check_consistency.py` proves reconciliation.
2. **Moving average**: RECEIVE updates
   `avg = (total_qty*avg + qty*cost)/(total_qty+qty)` across ALL locations
   (unit-tested); SIGN_OUT/RETURN snapshot current avg into `unit_cost`.
3. **Techs never see costs** — enforced in API response schemas, not the UI.
4. Negative stock is allowed but flags `went_negative` (drives the admin
   "recount" alert card).
5. Qty validation: integers for `each`/`box`, ≤2 decimals for `foot`.
6. Soft-delete only (`active` flags) — rows with history are never deleted.
7. Tech sign-out must stay ≤4 taps once on an item (Sign Out → qty → job →
   confirm; source pre-picked: their truck if it covers qty, else shop).

## Gotchas (each cost real debugging time)

- Fontsource families have a **space**: `"Inter Variable"`, `"Nunito
  Variable"` — `InterVariable` silently falls back to system fonts.
- `tailwind.config.js` edits require a dev-server **restart** (not hot).
- `Reports.tsx` `shaped`/`SHAPE_KEY` guard prevents a tab-switch crash
  (stale payload rendered under the new tab's shape) — keep it.
- Items/Jobs modal fields use plain-function `F()` helpers, NOT components —
  converting them remounts inputs and drops keyboard focus per keystroke.
- The app **always renders light/white** (`darkMode: "class"`, no toggle, by
  owner request). `dark:` variants remain in source, dormant — keep writing
  them for future opt-in.
- Backend keeps `barcode` fields + `/items/by-barcode/` even though the UI is
  scannerless (deliberate: cheap, keeps the door open).
- `/scan` route redirects to `/search` (old links).
- Old UI iterations referenced `html5-qrcode` and a Scanner component —
  both are fully deleted; do not reintroduce.
