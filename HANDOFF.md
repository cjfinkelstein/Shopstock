# APEX Electrical Stock — handoff package

This zip is the complete, working project. This file tells you (human or
Claude Code session) how to unpack it, run it, and keep iterating with full
context. **Start by reading `CLAUDE.md`** (Claude Code loads it automatically
when opened in this folder).

## What this is

A finished, verified v1 of an inventory + material sign-out PWA for an
8-person electrical contracting crew. Techs tap their name, find material
(search/browse — no barcode scanners by deliberate pivot), and sign it out to
jobs in ≤4 taps; the owner receives purchases, tracks moving-average cost
(hidden from techs), and bills material back per job. Full ledger
architecture: every stock movement is a transaction row, provably reconciled.

**Verified state at packaging (2026-07-27):** 30 backend tests pass, ledger
consistency check passes, `tsc` + production build clean, every screen
walked in-browser (tap-in → find → sign-out → cart checkout → all admin
pages), zero runtime errors trapped. Deployment path untested against a real
VPS (docker compose is written per spec but was never run here — no Docker on
the dev machine).

## Unpack & run (Windows; adjust paths on mac/linux)

```
unzip shopstock-handoff.zip
cd shopstock/api
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python scripts\seed.py        # demo data (or --minimal for a clean start)
.venv\Scripts\python -m uvicorn app.main:app --port 8000
# new terminal:
cd shopstock/web
npm install
npm run dev                                  # app on http://localhost:5173
```

Log in: tap any tech name, or "Admin login" with
`admin@shopstock.local` / `changeme123` (demo seed only).

Prove it's healthy after unpacking:

```
api: .venv\Scripts\python -m pytest tests -q          -> 30 passed
     .venv\Scripts\python scripts\check_consistency.py -> OK
web: npx tsc --noEmit && npm run build                 -> clean
```

## Read these, in order

1. `CLAUDE.md` — invariants, commands, gotchas (the distilled context).
2. `DECISIONS.md` — every product decision with numbering; the pivots
   (#26–31) explain why the app differs from the original spec.
3. `web/DESIGN.md` — the UI contract (v3). Any new screen/component must
   follow it or the app stops looking like one product.
4. `GO-LIVE.md` — owner-facing deployment runbook (VPS + phones).
5. `docs/ORIGINAL-SPEC.md` — the original build prompt, for archaeology.
   Superseded in places by DECISIONS.

## Project history (one paragraph per era)

1. **Build to spec**: FastAPI/Postgres ledger backend + React PWA with QR
   scanning, per `docs/ORIGINAL-SPEC.md`, all 8 phases + acceptance checklist.
2. **Design v1** ("looks primitive" feedback): design system introduced —
   Inter, SVG icon set, cards/sheets/toasts, motion, dark mode.
3. **Scannerless pivot + v2**: owner dropped barcode scanning. "Find" (search
   + color-coded category browse + recently-used) replaced the scanner as the
   core flow; cart mode reworked; richer visuals (hero cards, category color
   identity via `catTint`, 7-day activity chart).
4. **Design v3** (owner reference image): vivid gradient stat tiles, Nunito
   display font, circular icon discs, chart-on-indigo-card with callout chip,
   illustrated welcome, icon-only bottom nav, avatar account sheets, desktop
   dashboard grid, a11y sweep. Then **always-white theme** (dark mode disabled
   by request; `dark:` variants dormant in source).
5. **Go-live prep**: `seed.py --minimal` (real crew, no demo data, env-driven
   admin creds), GO-LIVE.md, PWA icons regenerated.

## Honest gaps / backlog (nothing hidden here)

- **No admin password-change UI** — set at seed time via env; changing later
  means updating `password_hash` in the DB (`hash_secret` in `app/auth.py`).
- **No offline mode** — service worker caches the app shell only (spec'd
  v1 decision); field use needs signal.
- **Docker/VPS path never executed** — compose + nginx + Dockerfiles exist
  and follow the spec, but the dev machine has no Docker; expect minor
  first-run friction.
- **No frontend tests** — backend has 30; UI was verified by browser walks.
- **Dark mode dormant** — full `dark:` coverage exists; enabling = add a
  toggle that sets `document.documentElement.classList.add('dark')` and
  persist it.
- **Shelf-label printing kept** (Avery 5160 with QR) even though scanning is
  gone — labels help humans find bins; harmless.
- Ideas discussed but not built: bulk item import from spreadsheet (offer
  stands — any Claude session can do this into `POST /items` + RECEIVE
  transactions), photo avatars, first-run tour, App Store wrapper
  (Capacitor + TestFlight) if the crew ever wants store distribution.

## For the next Claude Code session specifically

- Open the unpacked folder as the working directory; `CLAUDE.md` auto-loads.
- The owner (Josh) communicates in quick, non-technical strokes ("make it
  sleek", "white background") — interpret toward the v3 reference aesthetic
  documented in `web/DESIGN.md`, verify in the browser pane, and lead
  summaries with what changed, not how.
- Big UI passes here were run as parallel multi-agent workflows over disjoint
  file groups with `web/DESIGN.md` as the shared contract — that pattern kept
  6 agents consistent; reuse it for sweeping changes.
- Always end UI work with: `npx tsc --noEmit`, `npm run build`, a browser
  walk of tap-in → find → sign-out, and `pytest` + `check_consistency.py` if
  the API was touched.
