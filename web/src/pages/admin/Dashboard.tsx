import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api, fmtMoney, fmtQty, fmtWhen } from "../../api";
import Icon from "../../components/Icon";
import TxnList from "../../components/TxnList";
import { Empty, ListSkeleton } from "../../components/ui";
import type { Txn, TxnPage } from "../../types";

interface AdminDash {
  low_stock_count: number;
  low_stock: {
    item_id: number; sku: string; name: string; unit: string; image_data?: string | null;
    shop_qty: string; reorder_point: string; suggested_qty: string;
  }[];
  recount_needed: {
    item_id: number; sku: string; item_name: string; unit: string; item_image?: string | null;
    location_id: number; location_name: string; current_qty: string; flagged_at: string;
  }[];
  todays_signouts: Txn[];
  todays_activity_count: number;
  inventory_value: {
    total: string;
    by_location: { location_id: number; location_name: string; value: string }[];
  };
}

/* ---------- 7-day activity chart (white area line on the indigo hero card) ---------- */

interface DayBucket {
  key: string; // YYYY-MM-DD in America/New_York
  label: string; // weekday initial
  full: string; // human date for tooltip
  count: number;
}

const nyDayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

function WeekChart({ days }: { days: DayBucket[] }) {
  const W = 448;
  const H = 132;
  const slot = W / days.length;
  const top = 34; // headroom for the value callout chip
  const baseline = 104;
  const span = baseline - top;
  const max = Math.max(...days.map((d) => d.count));
  let maxIdx = -1;
  days.forEach((d, i) => {
    if (max > 0 && d.count === max) maxIdx = i; // rightmost (most recent) max
  });
  const pts = days.map((d, i) => ({
    x: i * slot + slot / 2,
    y: max === 0 ? baseline : baseline - (d.count / max) * span,
  }));
  // smooth path: cubic segments with horizontal tangents at every point (no overshoot)
  let line = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i - 1].x + pts[i].x) / 2;
    line += ` C${cx},${pts[i - 1].y} ${cx},${pts[i].y} ${pts[i].x},${pts[i].y}`;
  }
  const area = `${line} L${pts[pts.length - 1].x},${baseline} L${pts[0].x},${baseline} Z`;

  // white value-callout chip above the busiest day
  const chip =
    maxIdx >= 0
      ? (() => {
          const label = String(days[maxIdx].count);
          const w = label.length * 8 + 16;
          const h = 20;
          const x = Math.min(Math.max(pts[maxIdx].x - w / 2, 4), W - w - 4);
          return { label, w, h, x, y: pts[maxIdx].y - 12 - h, cx: pts[maxIdx].x, cy: pts[maxIdx].y };
        })()
      : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="mx-auto block h-auto max-h-[200px] w-full max-w-[640px]"
      role="img"
      aria-label="Transactions per day over the last 7 days"
    >
      <defs>
        <filter id="dash-chip-shadow" x="-40%" y="-40%" width="180%" height="220%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#171d51" floodOpacity="0.35" />
        </filter>
      </defs>
      <line x1="0" y1={baseline} x2={W} y2={baseline} strokeWidth="1" className="stroke-white/20" />
      <path d={area} className="fill-white/15" />
      <path
        d={line}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-white"
      />
      {chip && (
        <>
          <circle cx={chip.cx} cy={chip.cy} r="3.5" className="fill-white" />
          <g filter="url(#dash-chip-shadow)">
            <rect x={chip.x} y={chip.y} width={chip.w} height={chip.h} rx="6" className="fill-white" />
            <text
              x={chip.x + chip.w / 2}
              y={chip.y + chip.h / 2 + 4}
              textAnchor="middle"
              fontSize="12"
              fontWeight="800"
              className="fill-brand-700"
            >
              {chip.label}
            </text>
          </g>
        </>
      )}
      {days.map((d, i) => (
        <g key={d.key}>
          <text
            x={i * slot + slot / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            className="fill-white/60"
          >
            {d.label}
          </text>
          {/* invisible full-height hit area keeps the per-day tooltip */}
          <rect x={i * slot} y="0" width={slot} height={H} fill="transparent">
            <title>{`${d.full} — ${d.count} transaction${d.count === 1 ? "" : "s"}`}</title>
          </rect>
        </g>
      ))}
    </svg>
  );
}

export default function Dashboard() {
  const [dash, setDash] = useState<AdminDash | null>(null);
  const [week, setWeek] = useState<DayBucket[] | null>(null);
  const [recountOpen, setRecountOpen] = useState(false);

  useEffect(() => {
    api<AdminDash>("/dashboard/admin").then(setDash).catch(() => {});
  }, []);

  useEffect(() => {
    const days: DayBucket[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000);
      return {
        key: nyDayKey(d),
        label: d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "narrow" }),
        full: d.toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        count: 0,
      };
    });
    const range = `date_from=${days[0].key}&date_to=${days[6].key}`;
    (async () => {
      const p1 = await api<TxnPage>(`/transactions?${range}&page_size=200`);
      let txns = p1.items;
      if (p1.total > 200) {
        const p2 = await api<TxnPage>(`/transactions?${range}&page_size=200&page=2`);
        txns = txns.concat(p2.items);
      }
      const idx = new Map(days.map((d, i) => [d.key, i]));
      for (const t of txns) {
        const iso =
          t.created_at.endsWith("Z") || t.created_at.includes("+")
            ? t.created_at
            : t.created_at + "Z";
        const i = idx.get(nyDayKey(new Date(iso)));
        if (i !== undefined) days[i].count += 1;
      }
      setWeek(days);
    })().catch(() => {});
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  if (!dash)
    return (
      <div className="space-y-6 animate-fade-up">
        <div className="space-y-2">
          <div className="skeleton h-3.5 w-44" />
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-4 w-36" />
        </div>
        <div className="skeleton rounded-3xl" style={{ height: 196 }} />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="skeleton rounded-[22px]"
              style={{ height: 104, animationDelay: `${(i + 1) * 80}ms` }}
            />
          ))}
        </div>
        <div className="skeleton" style={{ height: 76 }} />
        <ListSkeleton rows={4} />
      </div>
    );

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Two-line header + subline */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-eyebrow">{today}</p>
          <h1 className="page-title mt-1">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">Here's what's moving</p>
        </div>
        <Link to="/admin/estimates" className="btn-primary">
          <Icon name="clipboard-list" size={18} />
          New estimate
        </Link>
      </div>

      {/* Chart + quick stats: stacked on mobile, 8/4 split at lg */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12">
        {/* 7-day activity chart on the indigo hero card */}
        <section className="hero-card p-5 lg:col-span-8 lg:flex lg:flex-col lg:justify-center">
          <div className="relative">
            <h2 className="mb-3 flex items-center gap-2">
              <Icon name="chart" size={14} className="text-white/70" />
              <span className="tile-caption">Activity — last 7 days</span>
            </h2>
            {week ? (
              <WeekChart days={week} />
            ) : (
              <div className="h-[132px] w-full animate-pulse rounded-2xl bg-white/10" />
            )}
          </div>
        </section>

        {/* Quick stats — vivid tiles (row on mobile, stacked column at lg) */}
        <div className="grid grid-cols-3 gap-3 lg:col-span-4 lg:grid-cols-1 lg:grid-rows-3 lg:gap-4">
          <Link to="/admin/stock" className="tile-blue relative block min-h-[96px]">
            <p className="tile-caption">Inventory value</p>
            <p className="stat-number mt-1 text-[20px] leading-tight sm:text-[24px]">
              {fmtMoney(dash.inventory_value.total)}
            </p>
            <span className="tile-fab">
              <Icon name="arrow-right" size={15} />
            </span>
          </Link>
          <Link to="/admin/activity" className="tile-purple relative block min-h-[96px]">
            <p className="tile-caption">Today's activity</p>
            <p className="stat-number mt-1 text-[20px] leading-tight sm:text-[24px]">
              {dash.todays_activity_count}
            </p>
            <span className="tile-fab">
              <Icon name="arrow-right" size={15} />
            </span>
          </Link>
          <Link to="/admin/reports" className="tile-indigo block min-h-[96px]">
            <p className="tile-caption flex items-center gap-1">
              Low stock
              {dash.low_stock_count > 0 && (
                <Icon name="alert-triangle" size={12} className="text-white/70" />
              )}
            </p>
            <p className="stat-number mt-1 text-[20px] leading-tight sm:text-[24px]">
              {dash.low_stock_count}
            </p>
            <span className="tile-fab">
              <Icon name="arrow-right" size={15} />
            </span>
          </Link>
        </div>
      </div>

      {/* Lower grid: DOM order = mobile order (alerts, locations, live updates);
          at lg live updates + locations fill the left 7 cols, alerts the right 5 */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-start">
        {/* Attention: recount needed */}
        <section className="lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1">
        {dash.recount_needed.length === 0 ? (
          <Empty
            icon="shield-check"
            title="All counts look sane"
            hint="No location has gone negative."
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setRecountOpen((o) => !o)}
              aria-expanded={recountOpen}
              aria-controls="recount-rows"
              className="alert-card transition-all duration-150 active:scale-[0.99]"
            >
              <span className="icon-disc bg-red-500 text-white">
                <Icon name="alert-triangle" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold text-slate-900 dark:text-slate-100">
                  Recount needed
                </span>
                <span className="block truncate text-[13px] text-slate-500 dark:text-slate-400">
                  {dash.recount_needed.length} item
                  {dash.recount_needed.length === 1 ? "" : "s"} went negative
                </span>
              </span>
              <span className="icon-disc h-8 w-8 bg-red-500/10 text-red-500">
                <Icon name={recountOpen ? "chevron-down" : "chevron-right"} size={18} />
              </span>
            </button>
            {recountOpen && (
              <div id="recount-rows" className="mt-2.5 space-y-2.5 animate-fade-up">
                {dash.recount_needed.map((r) => (
                  <div
                    key={`${r.item_id}-${r.location_id}`}
                    className="card flex items-center gap-3 p-3.5"
                  >
                    {r.item_image ? (
                      <img
                        src={r.item_image}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-full border border-slate-200/70 object-cover dark:border-slate-700"
                      />
                    ) : (
                      <span className="icon-disc bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400">
                        <Icon name="alert-triangle" size={20} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{r.item_name}</span>
                      <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">
                        {r.sku} · {r.location_name} · flagged {fmtWhen(r.flagged_at)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[17px] font-bold tabular-nums text-red-600 dark:text-red-400">
                        {fmtQty(r.current_qty, r.unit)}
                      </span>
                      <span className="badge bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300">
                        Recount
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Per-location value breakdown */}
      <section className="lg:col-span-7 lg:col-start-1 lg:row-start-2">
        <h2 className="section-title">
          <Icon name="dollar-sign" size={14} />
          Value by location
        </h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {dash.inventory_value.by_location.map((l) => (
                <tr
                  key={l.location_id}
                  className="border-b border-slate-50 last:border-0 dark:border-slate-800/60"
                >
                  <td className="px-4 py-3 font-semibold">{l.location_name}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">
                    {fmtMoney(l.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Live updates */}
      <section className="lg:col-span-7 lg:col-start-1 lg:row-start-1">
        <Link to="/admin/activity" className="section-title justify-between">
          <span className="flex items-center gap-2">
            <Icon name="zap" size={14} />
            Live updates
          </span>
          <span className="flex items-center gap-1 text-[12px] font-semibold normal-case tracking-normal text-brand-600 dark:text-brand-400">
            See all
            <Icon name="arrow-right" size={13} />
          </span>
        </Link>
        <TxnList txns={dash.todays_signouts} showUser />
      </section>
      </div>
    </div>
  );
}
