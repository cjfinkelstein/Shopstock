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
    gaps noted in `HANDOFF.md` and #32 above. (Update: now consumed by the
    offline write queue in #34 below.)

## Offline write queue (2026-09-30)

34. **Sign-out/return/transfer now queue instead of failing when offline.**
    `web/src/outbox.ts` wraps the three writes ItemSheet's Take Out/Return/
    Transfer flows send: `sendOrQueue()` tries the real request first (with
    a fresh `client_ref`, #33) and only queues to `localStorage` when the
    *network itself* is unreachable — a real server rejection (`ApiError`,
    e.g. blocked oversell) still surfaces immediately as before, unqueued,
    since retrying an outright-rejected write would just fail again.
    `App.tsx` flushes the queue on login and on every `online` event;
    `flushOutbox()` retries each entry independently so one failing at sync
    time (e.g. the job closed while offline) doesn't block the rest — it's
    marked "failed" and left for a person to retry or discard from the new
    "Sync queue" sheet (`TechLayout`'s offline banner extends to show
    pending/failed counts and opens it) rather than retried forever
    automatically.
    **Shared-device caveat**: each queued entry records the JWT `sub` of
    whoever queued it (decoded client-side, unverified — a UX safeguard,
    not a security boundary), and `flushOutbox()` only syncs entries
    belonging to the currently logged-in user. This stops a phone shared
    between techs from syncing tech A's queued sign-out under tech B's
    name after a login switch — but it also means an entry queued by
    someone who never logs back into that device sits there indefinitely,
    invisible to anyone else. Acceptable given CLAUDE.md's "techs find
    items on their phone" (personal devices); would need real handling
    (server-side queued-write visibility, an admin recovery path) if
    shared devices ever become a real scenario.
    ItemSheet's success screen distinguishes the two outcomes so a tech
    never mistakes a pending sync for a done one: a green checkmark for
    "confirmed," an amber upload icon + "Queued — will sync" for "queued."
    `Cart` checkout (batch endpoints) is NOT wired to the outbox — those
    endpoints don't accept `client_ref` (#33) and weren't in scope.
    Verified end-to-end with Playwright against a production build: two
    sign-outs queued while the browser context was offline, both drained
    and synced automatically on reconnect, stock decremented by exactly
    the queued quantities (no double-write) and the API shows exactly one
    transaction per queued entry.

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

## Bug fix: worker-map tiles (2026-10-01)

35. **Swapped the GPS map's tile provider off Esri's legacy free layer —
    twice.** The admin worker-map / shift-route map
    (`web/src/pages/admin/Calendar.tsx`) used
    `server.arcgisonline.com/.../World_Light_Gray_Base` — Esri's older
    anonymous-access tile service. Reported as "blank screen"; actual cause
    (confirmed via a user screenshot) was the tile images themselves coming
    back with "Map data not yet available" baked in as a placeholder — Esri
    degrading/sunsetting free anonymous access to that legacy layer, not a
    code bug. Pins, route lines, popups, and the Leaflet container itself
    were all rendering correctly the whole time; only the basemap imagery
    was broken. First swap: CARTO's free Positron basemap
    (`{s}.basemaps.cartocdn.com/...`) — closest aesthetic match to the
    light-gray minimal look DESIGN.md calls for. Deployed to production and
    found CARTO **also** now requires an API key for anonymous use (same
    "API KEY REQUIRED" placeholder pattern as Esri). Landed on plain
    OpenStreetMap tiles (`tile.openstreetmap.org/{z}/{x}/{y}.png`) — the one
    option that's free with no account/key, at the cost of OSM's busier
    default style instead of a light-gray minimal one. If that aesthetic
    mismatch bothers the owner later, the real fix is a CARTO (or similar)
    API key, not another provider swap.
    **Deployment incident while landing the first swap**: `shop
    .apexelectricalgroupinc.com` runs from `/opt/shopstock` on a DigitalOcean
    droplet, deployed by copying files (no git on the server) per
    GO-LIVE.md — so this fix had to be hand-applied there via `sed`, not a
    `git pull`. `docker compose up -d --build web` was run to rebuild the
    frontend, but since `web` depends on `api` in `docker-compose.yml`,
    `--build` cascaded and also rebuilt `api` from this server's local
    `./api` copy — which is a *stale* snapshot (this droplet was never kept
    in sync with the GitHub repo after its initial setup), missing
    migrations the live database had already been migrated past via the
    normally-running `ghcr.io/.../shopstock-api:latest` image built by CI.
    Result: `alembic.util.messaging: Can't locate revision identified by
    '0022'` on every request, and the tech tap-in list came up empty —
    **no data was lost** (confirmed directly via `psql`), but logins were
    blocked until `docker compose pull api && docker compose up -d api`
    restored the correct image. Lesson for next time: on this droplet,
    rebuild `web` alone with `docker compose build web && docker compose
    up -d --no-deps web` — never bare `--build` with a service that has
    `depends_on`, since it silently rebuilds stale dependencies too. This
    droplet's `/opt/shopstock/api` should really be brought in sync with
    (or replaced by) a real git checkout so this class of mismatch can't
    recur — flagged here, not yet done.

## Branch reconciliation before converting the droplet to git (2026-10-01)

36. **This session's branch forked before `main` gained migrations 0019–0022
    and a batch of unrelated features.** Investigating the "revision 0022"
    error (#35) surfaced that `main` already had `0019_password_reset.py`
    through `0022_pto_requests.py`, plus password reset, admin-configurable
    SMTP settings, and a PTO request workflow — none of it an ancestor of
    this branch, all of it already merged to `main` but never deployed to
    this droplet (which runs a disconnected manual file copy, not git; see
    #35). This session's own write-idempotency migration (#33) had
    independently claimed `0019`, colliding with the real one. Renamed it
    to `0023` (chaining after `0022`, the actual tip) before merging `main`
    into this branch.
    The merge itself was clean (no textual conflicts) but needed a semantic
    check: `main` had independently added `web/src/offlineQueue.ts`, an
    IndexedDB-backed offline queue for clock-in/out, whose own comment
    already flagged "material sign-out is a planned follow-up" — exactly
    what this session's `web/src/outbox.ts` (#34) turned out to be. The two
    coexist as separate, non-overlapping queues (different write types,
    different storage) rather than a collision; worth unifying later but
    not urgent.
    Verified the merged result properly, not just a clean `git merge`:
    `alembic heads` shows a single head at `0023`; full backend suite
    (35/35) and `check_consistency.py` pass against a fresh
    migrate-then-seed; `tsc`/build clean; and a real browser smoke test
    (admin login, Settings/SMTP page, the Calendar-sidebar fix from #35,
    tech tap-in, Home, My Hours' new PTO UI, and Find/Search from #32) hit
    zero console errors. This is the point: merging into `main` here means
    the droplet (once converted to a real git clone per #35's closing note)
    picks up all of that previously-merged-but-never-deployed work in the
    same motion as this session's own fixes — a much bigger jump than "just
    deploy tonight's fixes," flagged to and approved by the owner before
    proceeding.

## Offline GPS pings + a first-clock-in-offline bug (2026-10-02)

37. **GPS pings now queue offline too, not just clock in/out.** `offlineQueue.ts`
    (an IndexedDB queue already built for clock in/out, #36) gained a
    `gps_ping` action type: a failed `/time/ping` due to connectivity (not a
    real rejection) is queued instead of silently dropped, and replays in
    the same oldest-first queue as clock in/out -- which matters because
    `/time/ping` requires an open clock event server-side, so a queued ping
    has to land after its clock-in and before its clock-out, which the
    single shared queue guarantees for free.
    **Found and fixed a real bug along the way**: a tech's very *first*
    offline clock-in (never given GPS consent before) was silently failing
    end-to-end. `/time/clock-in` requires `gps_consent_at` to already be
    set server-side; `giveGpsConsent()` isn't itself queue-aware, and the
    existing code only skipped it when consent was already given -- so a
    first-time offline attempt called it, it threw (no connection), and
    the catch simply swallowed the failure and proceeded to `clockIn()`
    anyway. That let the clock-in queue locally and show success in the
    UI, but the *server* never got consent recorded, so when the queued
    clock-in replayed on reconnect it was rejected with a 403 the tech
    never saw -- transient toasts are easy to miss when a test isn't
    watching for them; the real tell was the UI silently reverting to
    "not clocked in" after sync. Added a `gps_consent` action type so a
    first-time offline consent call queues instead of being dropped, and
    replays before the clock-in behind it in the same queue.
    Caught this via an actual Playwright run against a real backend with
    Chromium's virtual clock fast-forwarding the real 2-minute ping
    interval -- not just code review -- and it's good that it did: the bug
    was invisible from reading the diff, only showed up as "nothing landed
    server-side" after a real offline-then-reconnect cycle. Verified via
    the real API afterward: `gps_consent_given: true`, correct clock-in,
    and a 3-point route (clock-in + both queued pings) all recorded in
    order after sync.

## Admin can now read clock-out notes in Login Hours (2026-10-02)

38. **A tech's clock-out note now shows in the admin "Login Hours" (Calendar)
    page for every shift in the "All techs" list, not only inside the
    day-detail sheet.** `clock_out_note` was already captured and already
    rendered in the day-detail Sheet's per-shift view, but the flatter
    "All techs" shift list (the view used when scanning one tech's whole
    history, which is what triggered this request) left it out entirely --
    an admin had no way to see what a tech wrote about their day without
    separately opening each day on the calendar. Added `note` to the
    `timesheet()` response in `api/app/routers/reports.py` (both the flat
    `rows` list and the per-tech grouped `shifts` list it's built from) and
    rendered it under the job/time line in the "All techs" row in
    `Calendar.tsx`, mirroring the existing italic quote styling from the
    day-detail sheet. No schema change -- `clock_out_note` already existed
    on the `TimeEntry` model; this only exposes it through the admin-facing
    report endpoint, which already stripped it before (admin endpoints need
    no cost-stripping concerns here, since notes aren't cost data).

## GPS ping idempotency + accurate capture time (2026-10-01)

39. **Extended the `gps_ping` offline-queue entry from #37 with the same
    write-idempotency `apply_transaction` already has (#33/#34), plus an
    accurate timestamp.** Two gaps in the #37 queueing: (1) a retried
    sync of the same queued ping — the request actually reached the server
    but the response never reached the device, so the client retries —
    wrote a second, duplicate point into the shift's route; (2) a ping
    that was captured hours earlier while offline and only just replayed
    got stamped with the *sync* time, not the time it was actually taken,
    so a late-syncing ping would show up on the route out of order and at
    the wrong time.
    Fixed both server-side: `location_pings` gained a nullable+unique
    `client_ref` column (migration `0024`, same pattern as
    `transactions.client_ref`), and `/time/ping` now checks it before
    inserting, so a replay with the same `client_ref` is a no-op instead
    of a duplicate row — mirroring `apply_transaction`'s idempotency
    check. `LocationPingIn` also gained an optional `recorded_at`; the
    client now captures it at the moment of the GPS fix and sends it
    through, and the server uses it when present, falling back to its own
    clock only when it's omitted (a live, online ping still doesn't
    bother sending it, since the server's receipt time is already
    correct for those).
    Verified: full backend suite (incl. a new test asserting a repeated
    ping with the same `client_ref` writes exactly one route point, with
    the captured `recorded_at` rather than the sync time) and
    `check_consistency.py` pass against a fresh migrate-then-seed;
    `tsc --noEmit` and the production build are clean.

## Shared Calendar editing restricted to admin + Ray (2026-10-07)

40. **The shared "Calendar" to-do board (`/calendar`, tech-visible, labeled
    "Calendar" in the admin sidebar to distinguish it from the admin-only
    "Login Hours" page) used to let every tech add/edit/check off items --
    the header literally said "Everyone can see & edit." By owner request,
    editing is now admin + one named tech (Ray) only; the other six techs
    still see it, just read-only.**
    There's no granular permissions system in this app (`User.role` is
    just `tech` | `admin`), and building one for a single named exception
    felt like the wrong size fix. Instead, added a narrow
    `require_calendar_editor` dependency in `calendar.py` that allows
    `role == "admin"` or a tech whose name matches "Ray" (case-insensitive),
    applied only to the shared calendar's `POST`/`PATCH` -- reads stay open
    to every tech, and nothing else in the app (costs, other admin
    endpoints, Ray's own tech-app experience) changes; he's still a normal
    tech everywhere else. If this needs to extend to more techs later,
    that's the point to build real per-user permissions instead of adding
    more names to the hardcoded set.
    Frontend (`TeamCalendar.tsx`) mirrors this by hiding the "Add a to-do"
    form, the edit affordance, and the done-checkbox for anyone who isn't
    admin or Ray -- the backend is the actual enforcement (a non-editor's
    write would 403 either way), this just avoids showing controls that
    would fail.
    Verified: new backend tests (a regular tech can read but gets 403 on
    write; a tech named Ray can write and a different tech still can't
    touch that event; admin can still write) pass alongside the full
    existing suite (39/39); `tsc --noEmit` and the production build are
    clean.

## Fixed the Ray match -- his account is "Raymond Bailey" (2026-10-07)

41. **#40's `require_calendar_editor` matched the whole `User.name` field
    against "ray" -- Ray tried it on the live site and was still locked
    out, because his real account is stored as the full "Raymond Bailey,"
    not "Ray."** Caught only once the owner actually tested it as Ray,
    which is exactly why the earlier PR description flagged this as "one
    assumption worth double-checking" -- it was wrong.
    Fixed by matching on the first word of the name instead of the whole
    string ("ray" or "raymond"), on both the backend check and the
    frontend's mirrored `canEdit`. Added a regression test using the real
    full name "Raymond Bailey" so this can't silently break the same way
    again -- a test seeded with just "Ray" (as the original test did)
    would never have caught it.

## Per-person task lists on the shared Calendar (2026-10-07)

42. **Ray can now write a bullet-point task list for each of three named
    techs (Adam, Ed, Avigdor) on a given calendar date, visible to
    everyone read-only -- a dedicated "Assignments" section in the
    day-detail sheet, separate from the general shared to-do list.**
    Reused the existing `CalendarEvent` model rather than building a new
    one: added a nullable `assignee` column (migration `0025`). An
    assigned entry is just a normal shared-calendar event with
    `title = assignee` and `notes` as newline-separated lines, rendered as
    `<li>` bullets instead of a paragraph; an ordinary to-do still has
    `assignee = null` and renders exactly as before. `require_calendar_editor`
    from #40/#41 already gates the write endpoints these go through, so no
    new permission logic was needed -- Ray and admin get a textarea per
    name to type/save into, everyone else just sees the bullets (or
    nothing, if empty, so a regular tech's view isn't cluttered with blank
    sections).
    `assignee` is deliberately a free-text label, not a `User` foreign key
    or name match -- #41 is a fresh reminder of how easily a real person's
    stored name can differ from what they're called day to day. Ray types
    whatever name he wants for a given box; nothing in the system tries to
    resolve it to an account.
    Verified beyond the type/build checks: an actual Playwright run against
    the dev server and a fresh seed -- tapped in as Ray, typed a two-line
    list into Adam's box, saved, confirmed both bullets render; then
    signed out and tapped in as a different tech (Sam) and confirmed the
    same bullets show read-only with no textarea and no "Add a to-do" box.
    Also confirmed directly in the database that the row landed as
    `assignee="Adam"` with the newline-separated notes intact.

## Per-person task boxes now append, not replace (2026-10-07)

43. **#42's Adam/Ed/Avigdor boxes saved the whole textarea as the new
    `notes` value -- so a second task typed into an already-filled box
    replaced the first one instead of adding to it. Ray reported "it only
    lets me write one task."** Fixed by changing the box from an editable
    full-text field to an add-only one: it always starts empty, and each
    "Add" appends whatever's typed (one line or several, so a paste still
    works) onto the existing bullets rather than overwriting them, then
    clears itself -- same mental model as the "Add a to-do" box elsewhere
    on this page. Verified with a Playwright run: added a task, confirmed
    it shows and the box clears; added a second, confirmed the *first* one
    is still there alongside it; added two more pasted as one multi-line
    block, confirmed all four persist.

## Assignee name chips on the month grid (2026-10-07)

44. **"I want to see the tasks in the right dates" when looking at the
    whole month, not just a single day's popup.** The month grid already
    showed each day's item titles (which, for an assignment, is just the
    assignee's name) -- but that preview list is `hidden` below the `md`
    breakpoint, i.e. invisible on a phone, where techs actually use this
    app. A day cell on mobile showed only a bare count badge, no names.
    Added a small always-visible chip row (not gated by the `md:` prefix)
    showing exactly which of Adam/Ed/Avigdor have a non-empty task list
    that date, separate from the existing desktop-only to-do title
    preview (which now excludes assignee entries, so a name isn't shown
    twice in two different styles on wider screens).
    Verified with Playwright at two viewport widths: added a task for
    Avigdor, confirmed the chip renders on a 1280px desktop view, then
    opened the same calendar in a fresh 390px-wide (phone-sized) context
    and confirmed the chip is both present *and* actually visible --
    catching exactly the kind of bug a type-check or a desktop-only visual
    check would have missed.

## Checkable per-task rows + clock-out task review (2026-10-07)

45. **"When techs are logging off show them the tasks they had today and
    allow them to check off what they completed."** This needed a real
    data model change: #42-#44's assignee feature stored one
    `calendar_events` row per (date, assignee) with the whole list as a
    newline blob in `notes` -- fine for display, but there was no field to
    mark one line done without touching the rest. Restructured to one row
    *per task*: `title` = the task text, `assignee` = the person, `done`
    = whether it's finished -- the exact same shape a general to-do
    already has, so checking off an assigned task reuses `toggleDone`
    unchanged, and it shows done (strikethrough) on the Team Calendar too,
    not just wherever it was checked off from. "Add" now creates one new
    row per non-blank line typed, instead of merging into a shared blob.
    **New permission wrinkle**: only admin/Ray can add or retitle tasks,
    but the *assignee themselves* needs to check off their own task at
    clock-out, and they're not a calendar editor. Extended
    `update_event`'s permission check (still admin/Ray for everything
    else) to allow a narrow exception: a user whose first name matches
    the task's `assignee` can PATCH *only* `done` on *that* row -- not
    retitle it, not touch anyone else's task, not touch an unassigned
    to-do. Covered by a new test asserting all four of those boundaries.
    Migration `0026` is a pure data migration (no schema change needed --
    `assignee`/`title`/`done` all already existed from #42): splits any
    existing blob-style row into one row per non-blank notes line. This
    matters because the feature had already been used live for a day
    before this change, so production had real rows in the old shape that
    needed converting, not just new code that assumes the new one.
    Verified the migration directly against a simulated pre-this-change
    SQLite row (multi-line blob) -- confirmed it splits into the right
    titles, leaves general to-dos alone, and that downgrade folds back
    into a blob (lossy on done-state, which the old shape had no field
    for anyway, but not on the task text).
    The clock-out sheet (`Home.tsx`) now fetches the clocked-in tech's own
    assigned tasks for today (only meaningful for Adam/Ed/Avigdor; a
    shared `isAssignee()` helper in a new `calendarAssignees.ts` keeps
    that name list in one place instead of duplicated across two files)
    and shows them as a checklist above the existing clock-out note,
    before the final Clock Out tap.
    Verified with a full Playwright run end to end, not just each piece
    in isolation: Ray assigns Ed a task on today's date -> Ed clocks in,
    opens the clock-out sheet, sees the task, checks it off (confirmed
    strikethrough) -> Ed finishes clocking out -> Ray reopens the Team
    Calendar and confirms the same task shows done there too, proving the
    "marks it done everywhere" requirement actually holds end to end, not
    just that each screen independently renders a checkbox.

## Clock-out photos with captions (2026-10-07)

46. **Second half of the clock-out request: a tech can attach photos (each
    with an optional caption) to their own clock-out, alongside the
    existing note.** New `clock_out_photos` table (migration `0027`) --
    `clock_event_id`, `caption`, `file_path`, `content_type`,
    `uploaded_by`. The actual bytes live on disk under
    `settings.uploads_dir`, not in the database, behind a new
    `uploads` Docker volume (`docker-compose.yml`) -- without that volume
    a rebuild silently wipes every photo, same failure mode `pgdata`
    already guards against for the database.
    Uploaded via a new multipart endpoint, `POST /time/clock-out/photos`,
    while the clock-out sheet is still open and the shift is still
    technically open server-side (clock-out itself is a separate, later
    call) -- that's what gives the upload a stable `clock_event_id` to
    attach to without any new "pending shift" concept. No offline queueing
    here, unlike clock in/out/pings: a multipart upload is a much bigger
    thing to replay reliably than a small JSON body, so a tech with no
    signal just gets a clear "couldn't upload" error instead of a silent
    queue that might retry a multi-MB file repeatedly. Rejects non-image
    content types and anything over 15MB before it touches disk.
    **Auth gap caught before it shipped**: a plain `<img src="/time/photos/
    5">` can't carry the Bearer token this API requires for an admin-only
    resource -- a browser image request never sends custom headers. Fixed
    with a small `AuthedImage` component (fetches via the existing
    authenticated-blob helper, hands the browser an object URL instead) --
    found this by actually reading through how authenticated images would
    need to load, not by hitting it in testing, since a broken `<img>`
    doesn't throw, it just silently shows nothing.
    Visibility matches `clock_out_note` exactly: admin sees any tech's
    photos (surfaced in both Login Hours views -- the "All techs" list and
    the day-detail sheet, both already showing the note), a tech can only
    ever fetch their own.
    Verified beyond type/build/backend-test checks: a full Playwright run
    with a real (if minimal) JPEG file -- picked a photo, typed a caption,
    uploaded it, confirmed the thumbnail and caption appear, finished
    clocking out, then logged in as admin and confirmed the same photo
    renders on Login Hours via a real `blob:` URL (proving the
    authenticated-fetch path actually works end to end, not just that the
    component compiles) alongside its caption.

## Migration 0026 crashed production on deploy -- fixed (2026-10-08)

47. **Deploying #46's migrations crash-looped the live `api` container.**
    `0026`'s upgrade deleted each old blob-style row after splitting it,
    but a real production row (one Ray had already checked done through
    the app before this deploy) had a `calendar_event_edits` row pointing
    at it -- `calendar_event_edits.event_id` is a foreign key, so deleting
    the parent first violated it, and Postgres rolled the whole migration
    back. No data was lost (Postgres runs each migration in a transaction)
    but the container couldn't start until this was fixed.
    My own local test of this migration (added when I first wrote 0026)
    only simulated a blob row with task text, not one with real edit
    history attached -- exactly the gap between synthetic test data and
    the actual shape of live data that bit #41 (Ray's name) too. Fixed by
    deleting a row's `calendar_event_edits` first (same lossiness already
    accepted elsewhere here -- the blob's edit history doesn't map onto
    the new per-task rows anyway), in both `upgrade()` and `downgrade()`.
    Verified by reproducing the exact failure locally this time: a blob
    row WITH a `calendar_event_edits` row pointing at it, confirming the
    old migration code fails the same way, then confirming the fix splits
    it cleanly with no orphaned edit rows left behind.

## Clock-out note is optional; photos pick from gallery (2026-10-08)

48. **Two small clock-out tweaks, by owner request: the note no longer
    blocks clocking out if left blank, and the photo picker no longer
    forces the camera open.** `ClockOutIn.note` dropped its
    `Field(min_length=1)` (now `str | None`); the frontend's Clock Out
    button is no longer disabled on an empty note, and the sheet's
    subtitle says "Optional" now. Separately, the photo `<input>` had
    `capture="environment"`, which on mobile skips straight to the camera
    -- removed so Android/iOS show the normal camera/gallery/files choice,
    letting a tech attach an existing photo instead of only a fresh one.

## Shared, everyone-can-see photo feed (2026-10-08)

49. **Clock-out photos are no longer admin-only -- any logged-in user
    (tech or admin) can now see any photo, on a new dedicated "Photos"
    page showing who took it, the shift's date, and the caption they
    wrote.** `clock_out_note` (the text note) stays admin-only and
    unchanged -- this is specifically about the photos, by explicit owner
    request ("allow anyone to see it").
    `GET /time/photos/{id}` dropped its admin-or-uploader check (now any
    authenticated user); added `GET /time/photos`, a new list endpoint
    returning every photo across every tech with `uploaded_by_name` and
    `shift_date` (the clock event's date) joined in, since a standalone
    feed item has no surrounding shift row to supply that context the way
    the Login Hours view does.
    New `Photos.tsx` page (route `/photos`, and `/admin/photos` for
    symmetry with the Team Calendar pattern), linked from the tech account
    sheet and the admin sidebar -- deliberately not added as a third hero
    card on tech Home, which already gained the Team Calendar card in #46;
    two taps via the account menu (matching "My Hours") felt like enough
    for something browsed occasionally rather than used every shift.
    Verified end to end: Al clocks out with a photo and caption but no
    note (exercising #48 at the same time) -- then a *different* tech
    (Shui, who never touched that shift) opens `/photos` and confirms
    Al's name, the shift date, the caption, and the photo itself (via a
    real authenticated `blob:` URL) all render -- proving a tech who isn't
    admin and isn't the uploader can now see it, which is the actual
    change here.

## Home shows the full calendar; stock stuff and photos become tabs (2026-10-08)

50. **Tech Home page restructured again, by owner request: the whole
    calendar grid shows immediately (not just a link to it), Find
    material + In stock now move off Home entirely, and Photos becomes
    its own bottom-nav tab.** Clock in/out stays first, as established in
    #46.
    `TeamCalendar` gained an `embedded` prop that hides its own header
    (back button, "Team Calendar" title) when rendered inline elsewhere --
    reused as-is on Home rather than duplicating the grid/day-sheet logic
    a second time, so there's exactly one place that code lives and no
    risk of the two views drifting apart.
    Find material and "In stock now" weren't actually deleted as a
    feature -- the center floating-action button already went to
    `/search` before this change (it's effectively already its own "tab"),
    so Home just stopped *also* showing a duplicate hero card and item
    preview for the exact same destination. Removing the preview meant
    the `inStock` fetch, state, and the now-unused `Item`/`ItemThumb`
    imports came out too.
    Added Photos as a proper bottom-nav tab (it was a one-off addition to
    the account menu in #49) and removed the now-redundant account-menu
    entry, since the tab is the more discoverable path for something
    meant to be seen, not buried two taps deep.
    Verified interactively: confirmed "Find material" and "In stock now"
    no longer appear anywhere on Home, confirmed the actual month grid
    (not a link) renders immediately below the clock card, confirmed
    Find material is still reachable via the center button, and confirmed
    the new Photos tab navigates correctly.

## Dropped the Calendar and Cart bottom-nav tabs (2026-10-08)

51. **Follow-up to #50: removed the standalone "Calendar" tab and the
    "Cart" tab from the bottom nav -- the calendar should only live
    embedded on Home now, not also have its own separate destination.**
    Also removed the "Team Calendar" account-menu link for the same
    reason (it pointed at the same now-redundant standalone view).
    Cart wasn't deleted as a destination, just its bottom-nav tab -- it's
    still one tap away via the existing Cart stat tile on Home (shows the
    pending-item count the same way the tab's badge used to), so nothing
    was actually lost, just a second nav affordance for a page Home
    already links to. Bottom nav is now Home / Trucks / [Search FAB] /
    Timesheet / Photos -- a cleaner 2-and-2 balance around the center
    button, down from 3-and-3.
    Verified interactively: confirmed both tabs are gone from the nav,
    confirmed the calendar still renders embedded on Home, and confirmed
    Cart is still reachable via its Home stat tile.

## Tap a photo to see it full size (2026-10-08)

52. **"Doesn't let me view it" on the Photos page turned out to mean the
    thumbnail (96x96px) is too small to actually read a photographed
    document -- there was no way to see it bigger.** Added a lightbox:
    tapping a thumbnail opens a full-screen view (the same `AuthedImage`,
    just larger, `object-contain` so it isn't cropped) with the uploader,
    date, and caption repeated underneath; tap the backdrop, the X, or
    Escape to close. Built as its own overlay (not the existing `Sheet`
    component, which is bottom-anchored and sized for form content, not a
    full-bleed image).
    Verified with Playwright: uploaded a real photo at clock-out, opened
    `/photos`, tapped the thumbnail, confirmed the full-size image and
    close button render, confirmed closing it removes the overlay.
