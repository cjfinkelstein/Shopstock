# DECISIONS.md — judgment calls where the spec was silent or in tension

Each entry: what was decided, and why.

## Platform / stack

1. **SQLite fallback for local dev & tests.** The spec mandates PostgreSQL 16 in
   production (docker-compose uses it), but the build machine had no Docker or
   Postgres. `DATABASE_URL` defaults to SQLite; a custom `Num` type keeps numeric
   behavior consistent (exact `NUMERIC` on Postgres, quantized-Decimal handling on
   SQLite). All money math is done in Python `Decimal` and quantized before storage,
   so results are identical on both engines.
2. **Timestamps stored as naive UTC** (`DateTime` without timezone) so SQLite and
   Postgres behave identically; serialized with an explicit `+00:00` offset and
   rendered in `America/New_York` by the frontend. Report date filters interpret
   `YYYY-MM-DD` as NY-calendar days and convert the boundaries to UTC.
3. **QR labels are generated server-side** (Python `qrcode` → inline SVG in the
   print-ready HTML). The spec's API section says `POST /labels/print` returns a
   print-ready HTML page, while the stack section suggested client-side `qrcode` JS;
   both couldn't be the single source. Server-side won: the endpoint is exactly to
   spec, the page is self-contained (no JS at all), and the frontend just opens it in
   a new tab for printing. The `qrcode` npm dependency was dropped as redundant.
4. **PyJWT + `bcrypt`** directly instead of `python-jose`/`passlib` (both
   less-maintained; passlib has known breakage with bcrypt ≥4 on Python 3.13).

## Auth

5. **Session length**: 12 h for techs per spec; admin sessions also 12 h (spec silent).
6. **`POST /auth/logout`** exists but is client-side token discard — JWTs are
   stateless and 12 h is short enough that a server-side denylist wasn't warranted.
7. **PIN enablement** = "PIN set": `pin_hash` non-null means required. Admin sets or
   clears a tech's PIN in Settings (default OFF for everyone, per spec).
8. **`GET /users/techs` is unauthenticated** by spec (powers the tap screen). It
   returns only id, name, and a has-PIN flag — no emails, roles, or hashes.

## Ledger

9. **TRANSFER and ADJUST snapshot `unit_cost` = current avg** for audit visibility,
   but neither affects the moving average, and job costing reads only
   SIGN_OUT/RETURN rows — so there is no cost impact, as required.
10. **RETURNs are allowed against closed jobs** (material comes back after
    closeout); SIGN_OUTs require an *active* job.
11. **"Recount needed"** = items with a `went_negative` transaction that has **no
    later ADJUST with reason `count_correction`** touching the same item+location.
    Current qty merely returning positive (e.g. via a transfer in) does not clear the
    flag — the count is still suspect until someone actually recounts.
12. **`ADJUST` API shape**: callers send `location_id` + `direction`
    (increase/decrease); the router maps that to the spec's from/to signed
    representation. Less error-prone for the UI than raw from/to.
13. **Batch receive endpoint added** (`POST /transactions/receive/batch`) beyond the
    spec'd sign-out/transfer batches, so the admin Receive screen submits one atomic
    PO instead of N sequential requests.
14. **Negative-qty guard on RETURN/RECEIVE**: none needed — they only add stock.
    Oversell flagging applies wherever a `from_location` balance dips below zero
    (sign-out, transfer, and decrease-adjust all flag).

## Costing

15. **Moving average quantized to 4 decimals** (`numeric(10,4)`) with
    ROUND_HALF_UP; stock quantities to 2 decimals (`numeric(12,2)`) per the schema.
16. **Job-materials view nets RETURNs against SIGN_OUTs** per item at each row's
    snapshot cost; the "avg cost" column shown is derived (net cost ÷ net qty).

## Frontend

17. **≤4-tap sign-out**: foot-unit quick chips (+25/+50/+100/+250) confirm
    immediately when the pad is empty, and the source-location step is folded into
    the confirm screen with the default pre-selected (My Truck when it holds ≥ qty,
    else Shop). Scan → **Sign Out → chip → job → Confirm** = 4 taps. Manual qty
    entry still available (chips accumulate once digits are typed).
18. **Optimistic sign-out**: the green success screen shows immediately and returns
    to Scan; if the API then fails, the UI rolls back with a prominent red
    "nothing was recorded" toast and refetches stock.
19. **Cart checkout resolves a source per line** using the same default rule
    (truck-if-covered, else shop) right before submitting the batch, since the batch
    is "many items, one job" but items may live in different places.
20. **Categories are free text on items** (no categories table in the spec's data
    model). Settings lists the distinct values; Search/Items filter by them.
21. **Camera fallback**: the Scan screen always offers manual code entry (used on
    desktops and when camera permission is denied) — also satisfies the
    "simulated camera input" acceptance path.
22. **PWA scope**: manifest + icons + install prompt + app-shell service worker
    (network-first navigations, cache-first hashed assets, `/api` never cached) —
    explicitly no offline data sync, per spec.
23. **Admins get the tech UI too** (tabs + an "Admin" switch), since admin needs to
    do everything a tech can; tech-facing pages never render cost data anyway, and
    admin-only data lives under `/admin` routes guarded by role.

## v2 pivot — scannerless (owner request, 2026-07-26)

26. **Barcode scanning removed from the product.** Techs pick items via the
    **Find** screen: search, category browse (color-coded), and a recently-used
    row derived from their own transactions. The camera scanner, `/scan` route,
    and `html5-qrcode` dependency are gone; `/scan` redirects to `/search`.
    The backend keeps `barcode` fields and `GET /items/by-barcode/{code}` —
    harmless, and they keep the door open if scanners ever come back.
27. **Label printing kept as "Shelf labels"** (admin): physical bin labels still
    help humans find stock even without scanning them.
27a. **Re-removed a scanner regression (2026-09-30).** This handoff snapshot
    somehow still had a fully wired camera scanner (`BarcodeScanner.tsx`,
    `html5-qrcode` dependency, a "Scan" button in Find) despite #26 saying
    it was gone — deleted again. If it reappears a third time, check
    whatever produced the zip/snapshot, not just the working tree.
28. **Design system v2** (`web/DESIGN.md`): category color identity via
    `catTint`, two-line page headers, gradient hero cards, segmented controls,
    and a 7-day activity chart on the admin dashboard.

## v3 — "vivid & friendly" look (owner reference image, 2026-07-26)

29. **Design v3** matches the owner's reference: near-white canvas, saturated
    blue/purple color-block stat tiles (`tile-blue/purple/indigo`), circular
    icon discs in lists, the 7-day activity chart as a white area-line on an
    indigo card with a value callout chip, a red "needs attention" alert-card
    pattern, and a flat geometric SVG illustration on the welcome screens.
30. **Nunito Variable** is the display font (headings, big numbers) with Inter
    for body text. Bug fixed along the way: Fontsource families are named
    "Inter Variable"/"Nunito Variable" (with a space) — the earlier
    "InterVariable" stack silently fell back to system fonts.

31. **Always-white theme** (owner request): the app renders the white/light
    theme for everyone — Tailwind `darkMode: "class"` with no toggle, so
    OS-level dark mode no longer switches the app to dark. All `dark:`
    variants remain in the source for a future opt-in toggle.

## Write idempotency (2026-09-30) — groundwork for an offline write queue

33. **`client_ref` added to transactions, backend only, nothing calls it yet.**
    `Transaction.client_ref` (nullable `String(64)`, unique index — SQLite
    and Postgres both allow unlimited NULLs, so callers that omit it never
    collide) lets a retried write replay its original result instead of
    moving stock twice. `apply_transaction()` checks for an existing row
    with the same `client_ref` before doing anything else, and wraps the
    insert in a SAVEPOINT (`db.begin_nested()`) to catch the unique-index
    race without rolling back the caller's whole transaction — relevant
    because batch endpoints loop `apply_transaction()` before one shared
    commit. Wired into `SignOutIn`/`ReturnIn`/`TransferIn` and their
    routers only (not `receive`/`adjust`, which are admin/desktop, or the
    batch endpoints, which aren't part of the planned offline flow).
    This exists so a future client-side offline outbox (queued sign-out/
    return/transfer, replayed on reconnect) can safely retry a write whose
    response was lost without double-signing material — see the offline
    gaps noted in `HANDOFF.md` and #32 above. No client sends `client_ref`
    yet; this PR is backend-only groundwork.

## Offline browsing (2026-09-30)

32. **Offline browsing added, offline writes still out of scope.** The
    service worker (`web/public/sw.js`) now caches a safelist of tech browse
    GETs (`/items`, `/items/:id`, `/items/:id/stock`, `/items/categories`,
    `/locations`, `/stock`, `/dashboard/tech`, `/jobs`, `/jobs/recent`,
    `/transactions`) stale-while-revalidate, so Find/Trucks/item-detail work
    with no signal. Gated to the `tech` JWT role (decoded client-side,
    unverified — a caching decision, not a security boundary) so an admin's
    cost-bearing responses for the same paths are never persisted to disk;
    `/stock/valuation` and everything else under `/api/` stays network-only.
    Sign-out/return/transfer remain network-only per #22 — no local outbox
    or sync/conflict handling yet, since every write still has to go through
    `apply_transaction` against live stock and moving-average cost. Logout
    posts `CLEAR_DATA_CACHE` to the service worker so a shared phone's next
    tech doesn't see stale cached data. A `useOnline()` hook drives a visible
    "Offline — showing saved data" banner in `TechLayout` so a cached screen
    never looks live. `/auth/me` itself isn't cacheable (it's how a 401 is
    detected), so `AuthProvider` also caches the last-known user object in
    `localStorage` and falls back to it when that check fails for a
    non-401 reason (offline, DNS, 5xx) — otherwise every cold reload with no
    signal bounced a tech back to tap-in before they ever saw the cached
    data, defeating the feature.

## Seed

24. Opening stock enters via real RECEIVE transactions (`ref=OPENING`) and truck
    loads via TRANSFERs — the ledger reconciles from the first boot, proven by
    `scripts/check_consistency.py`. Three trucks get starting stock (spec: "2–3").
25. Seed is guarded: it refuses to run against a database that already has users.
