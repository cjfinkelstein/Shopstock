# APEX Electrical Stock Design System v3 — the contract every screen follows

**v3 direction — "vivid & friendly" (owner picked a reference: white canvas,
saturated blue/purple color-block tiles, rounded friendly type, circular icons,
chart on a colored card, illustrated welcome).** Rules:

- **Type**: `page-title` and big numbers now use the rounded display font
  automatically (`font-display` = Nunito). Use `stat-number` on every large
  numeric readout. Body text stays Inter — do not put font-display on
  paragraphs.
- **Vivid tiles** for headline stats: `tile-blue` / `tile-purple` /
  `tile-indigo` (white text, built-in corner glow). Inside: `tile-caption`
  line, then the value `stat-number text-[28px]`, optional small white/70
  subline, and a `tile-fab` disc with a 15px arrow-right Icon bottom-right
  when the tile navigates. Never put slate/dark text on a vivid tile; never
  use vivid tiles for long lists — headline stats only (2–3 per screen max).
- **Icon discs**: list rows now use `icon-disc` (circle) instead of square
  `icon-tile` on tech screens and dashboard lists. Same catTint/type colors.
  Keep `icon-tile` only inside dense admin tables.
- **Alert card** pattern for things needing attention: `alert-card` +
  `icon-disc bg-red-500 text-white` (alert-triangle) + bold title + muted
  count line + trailing `icon-disc h-8 w-8 bg-red-500/10 text-red-500`
  (chevron-right). Amber variant allowed for low stock (border-amber-100
  bg-amber-50/70 etc.).
- **Chart on a colored card**: the dashboard activity chart sits on a
  `hero-card` (indigo gradient) — white 2.5px line + white/15 area fill +
  white value-callout chip; axis labels white/60. (Single series, no legend.)
- **Canvas**: body is pure white and the app ALWAYS renders the light theme
  (Tailwind darkMode:"class" with no toggle — dark: variants remain in source
  for a future opt-in but never apply). Cards separate via the built-in soft
  shadows + light borders; never add borders darker than slate-200.
- **Welcome screens**: `<Illustration className="w-full max-w-[300px]"/>`
  from `components/Illustration` + two-tone headline (first line slate,
  second line text-brand-600) + full-width CTA with a trailing arrow-right.
- Everything else from v1/v2 still applies (Sheet, Empty, seg, catTint,
  two-line headers, badges, no emoji, light+dark, 48px targets).

Sleek, modern, glove-friendly. Light + dark (Tailwind `dark:` via media query) on
**every** element. Inter variable font is global. **No emoji in UI** — use the
`Icon` component. Behavior/API calls stay exactly as they are unless a note says
otherwise; this is a visual + interaction layer.

**v2 additions — richness rules (the app must NOT read as flat/basic):**
- **No barcode scanning exists anymore.** The primary tech action is **Find**
  (search + browse). Never reference scanning, cameras, or labels on tech
  screens. Old `/scan` links → `/search`.
- **Category color identity everywhere an item appears**: `import { catTint }
  from "../catcolor"` → `catTint(item.category)` gives `{tile, badge, icon}`.
  Item rows/tiles use `<span className={\`icon-tile ${t.tile}\`}><Icon name={t.icon}/></span>`.
- **Every screen opens with a two-line header**: `page-eyebrow` line (context —
  date, count, category…) above `page-title`. Never a lone bare title.
- **`hero-card`** class = gradient surface with built-in glow blobs for each
  page's ONE hero moment (Home's Find card, item sheet header, dashboards).
- **`seg` / `seg-item` / `seg-item-active`** for two-to-four-way toggles
  (direction pickers, filters) — never loose chip pairs for mutually-exclusive
  choices.
- **`glow-backdrop`** on full-screen entry pages (tap-in, login): wrap page in
  `relative`, drop `<div className="glow-backdrop" />` first.
- Numbers get stage presence: primary stat `text-[30px] font-bold tracking-tight
  tabular-nums`, unit as a small muted suffix, deltas colored.
- Section headers pair `section-title` with a 14px Icon.

## Primitives (already built — use, don't reinvent)

```tsx
import Icon from "../components/Icon";            // <Icon name="truck" size={22} strokeWidth={2} filled? />
import Sheet from "../components/Sheet";          // <Sheet title subtitle? onClose>…  (drag handle + slide-up built in)
import { Empty, ListSkeleton, SuccessCheck, Spinner, PageLoader, Avatar } from "../components/ui";
```

Icon names: home scan camera search truck history cart plus minus x check
chevron-right chevron-down arrow-left arrow-right arrow-swap printer package
briefcase chart settings users alert-triangle trash pencil download logout store
zap inbox tag file-text layers keypad backspace refresh dollar-sign shield-check
clipboard-list mail lock moon wrench

## CSS classes (defined in index.css — the only building blocks)

- Buttons: `btn-primary` (gradient, use ONE per screen for the main action),
  `btn-secondary`, `btn-ghost`, `btn-danger`, `icon-btn` (44px round).
- Surfaces: `card` (rounded-2xl, layered shadow), `card-interactive` (adds hover
  lift + press), `glass` (blurred bar — headers/navs only).
- Forms: `input`, `label` (use `<label className="label">` above every input).
- Chips: `chip` / `chip chip-active`, `badge`.
- Loading: `skeleton` (+ inline height), or `<ListSkeleton/>`.
- Text: `page-title` (screen h1), `section-title` (uppercase small heading),
  `tabular-nums` on every number column. `icon-tile` = 44px rounded icon square.
- Motion: wrap each page's root in `animate-fade-up`. Sheets/modals animate
  themselves. `animate-scale-in` for centered modals. Never animate on every
  keystroke/re-render — entrance only.

## Patterns

**Page root** (tech pages):
```tsx
<div className="space-y-5 animate-fade-up">
  <h1 className="page-title">Title</h1>
  …
</div>
```

**List row** (replaces plain bordered rows everywhere):
```tsx
<button className="card-interactive flex w-full items-center gap-3 p-3.5">
  <span className="icon-tile bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
    <Icon name="package" size={20} />
  </span>
  <span className="min-w-0 flex-1">
    <span className="block truncate font-semibold text-[15px]">Primary</span>
    <span className="block truncate text-[13px] text-slate-400">secondary · meta</span>
  </span>
  <span className="text-[17px] font-bold tabular-nums">42 ft</span>
  <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
</button>
```
Icon-tile tints by content type: items `bg-brand-50 text-brand-600`, trucks
`bg-violet-50 text-violet-600`, jobs `bg-amber-50 text-amber-600`, money/value
`bg-emerald-50 text-emerald-600` (+ dark `dark:bg-<c>-500/15 dark:text-<c>-400`).

**Txn type badges** (badge class + these exact tints):
SIGN_OUT `bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300`,
RETURN `bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300`,
TRANSFER `bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300`,
RECEIVE `bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300`,
ADJUST `bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`.

**Status is never color alone** — warning/critical rows pair an
`alert-triangle` icon with a visible word ("Recount", "Low", "went negative").
Critical = red-600, warning = amber-600, good = emerald-600.

**Empty states**: always `<Empty icon title hint action?/>` — never a bare
"nothing here" paragraph. **Loading**: `<ListSkeleton/>` or `<PageLoader/>` —
never the word "Loading…".

**Tables (admin)**: wrap in `card overflow-x-auto p-0`; header row
`text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b
border-slate-100 dark:border-slate-800`; body rows `border-b border-slate-50
dark:border-slate-800/60 last:border-0`, cell padding `px-4 py-3`; numbers
right-aligned `tabular-nums`. On hover `hover:bg-slate-50/60
dark:hover:bg-slate-800/40`.

**Modals (admin, desktop-centered)**: backdrop `fixed inset-0 z-50 flex
items-center justify-center bg-slate-950/45 backdrop-blur-[2px] p-4
animate-fade-in`, panel `w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl
dark:bg-slate-900 animate-scale-in`. Sheets are preferred on mobile-first tech
screens; modals fine for admin.

**Busy buttons**: `disabled={busy}` + `{busy ? <Spinner/> : null} Label`.

**Numbers**: qty via existing `fmtQty`, money via `fmtMoney`, dates via
`fmtWhen`. Big stats: `text-[26px] font-bold tracking-tight tabular-nums`.

## Don'ts
- No emoji. No `prompt()`/`confirm()` (build small sheets/modals instead).
- No new npm deps. No route/API changes. No cost data on tech screens.
- Don't touch: api.ts, auth.tsx, cart.tsx, types.ts, App.tsx, main.tsx,
  index.css, tailwind.config.js, Icon.tsx, ui.tsx, Sheet.tsx, toast.tsx,
  TechLayout.tsx.
- Keep every existing data flow, default, and tap count intact (the 4-tap
  sign-out is an acceptance requirement).
