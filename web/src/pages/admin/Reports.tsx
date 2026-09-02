import { useCallback, useEffect, useState } from "react";

import { api, downloadCsv, fmtMoney, fmtQty, fmtWhen } from "../../api";
import { hoursLabel } from "../../hours";
import { catTint } from "../../catcolor";
import Icon from "../../components/Icon";
import { Avatar, Empty, ItemThumb, ListSkeleton } from "../../components/ui";

type Tab =
  | "reorder"
  | "usage-by-tech"
  | "usage-by-job"
  | "receiving"
  | "maurice"
  | "adjustments"
  | "timesheet"
  | "pnl";

const TABS: { key: Tab; label: string }[] = [
  { key: "reorder", label: "Reorder" },
  { key: "usage-by-tech", label: "Usage by tech" },
  { key: "usage-by-job", label: "Usage by job" },
  { key: "receiving", label: "Receiving" },
  { key: "maurice", label: "Maurice" },
  { key: "adjustments", label: "Adjustments" },
  { key: "timesheet", label: "Timesheets" },
  { key: "pnl", label: "Profit & Loss" },
];

const MAURICE_VENDOR_NAME = "Maurice Electrical Supply";

const THEAD_ROW =
  "border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800";
const BODY_ROW =
  "border-b border-slate-50 last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/40";

export default function Reports() {
  const [tab, setTab] = useState<Tab>("reorder");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<any>(null);
  const [mauriceId, setMauriceId] = useState<number | null>(null);
  const [jobTab, setJobTab] = useState<number | null>(null);
  const [qboOpen, setQboOpen] = useState(false);
  const [qboJobIds, setQboJobIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    api<{ id: number; name: string }[]>("/vendors")
      .then((vendors) => setMauriceId(vendors.find((v) => v.name === MAURICE_VENDOR_NAME)?.id ?? null))
      .catch(() => {});
  }, []);

  const query = `date_from=${from}&date_to=${to}`;

  const endpoint = useCallback(
    (format?: "csv" | "qbo") => {
      const suffix = format ? `&format=${format}` : "";
      if (tab === "reorder") return `/reports/reorder${format ? "?format=csv" : ""}`;
      if (tab === "maurice") return `/reports/receiving?vendor_id=${mauriceId ?? ""}&${query}${suffix}`;
      return `/reports/${tab}?${query}${suffix}`;
    },
    [tab, query, mauriceId],
  );

  const load = useCallback(() => {
    if (tab === "maurice" && mauriceId === null) return;
    setData(null);
    api(endpoint()).then(setData).catch(() => {});
  }, [tab, endpoint, mauriceId]);

  useEffect(load, [load]);

  const csv = () => downloadCsv(endpoint("csv"), `${tab}.csv`);
  const qbo = () => {
    const all: any[] = data?.jobs ?? [];
    const ids = [...qboJobIds];
    const suffix = ids.length && ids.length !== all.length ? `&job_ids=${ids.join(",")}` : "";
    downloadCsv(`/reports/usage-by-job?${query}&format=qbo${suffix}`, "quickbooks-job-materials.csv");
    setQboOpen(false);
  };
  const toggleQboJob = (id: number) => {
    setQboJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const SHAPE_KEY: Record<Tab, string> = {
    reorder: "categories",
    "usage-by-tech": "techs",
    "usage-by-job": "jobs",
    receiving: "receiving",
    maurice: "receiving",
    adjustments: "adjustments",
    timesheet: "techs",
    pnl: "by_job",
  };
  const shaped = data && SHAPE_KEY[tab] in data;

  useEffect(() => {
    if (tab !== "usage-by-job" || !shaped) return;
    const jobs: any[] = data.jobs;
    if (!jobs.some((j) => j.job_id === jobTab)) setJobTab(jobs[0]?.job_id ?? null);
    setQboJobIds(new Set());
  }, [tab, shaped, data]);

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="min-w-0">
        <p className="page-eyebrow">Insights</p>
        <h1 className="page-title">Reports</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`chip ${tab === t.key ? "chip-active" : ""}`}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        {tab !== "reorder" && (
          <>
            <label className="block">
              <span className="label">From</span>
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">To</span>
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
        <button className="btn-secondary" onClick={csv}>
          <Icon name="download" size={18} />
          Download CSV
        </button>
        {tab === "usage-by-job" && (
          <button className="btn-secondary" onClick={() => setQboOpen((o) => !o)}>
            <Icon name="download" size={18} />
            Export to QuickBooks
          </button>
        )}
      </div>

      {tab === "usage-by-job" && qboOpen && shaped && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-bold uppercase tracking-wider text-slate-400">
              Choose jobs to include
            </span>
            <div className="flex gap-2">
              <button
                className="btn-ghost min-h-0 py-1 text-[13px]"
                onClick={() => setQboJobIds(new Set(data.jobs.map((j: any) => j.job_id)))}
              >
                Select all
              </button>
              <button className="btn-ghost min-h-0 py-1 text-[13px]" onClick={() => setQboJobIds(new Set())}>
                Select none
              </button>
            </div>
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {data.jobs.map((j: any) => (
              <label
                key={j.job_id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded accent-brand-600"
                  checked={qboJobIds.has(j.job_id)}
                  onChange={() => toggleQboJob(j.job_id)}
                />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                  {j.job_number} — {j.job_name}
                </span>
                <span className="text-[13px] text-slate-400">{fmtMoney(j.total_cost)}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <button className="btn-ghost" onClick={() => setQboOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={qboJobIds.size === 0} onClick={qbo}>
              <Icon name="download" size={18} />
              Export {qboJobIds.size} job{qboJobIds.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {/* data can briefly hold the PREVIOUS tab's payload right after a tab
          switch (the clearing effect runs post-render) — guard on shape too */}
      {!shaped && <ListSkeleton rows={5} />}

      {shaped && tab === "reorder" && (
        <div className="space-y-6">
          {data.categories.length === 0 && (
            <Empty
              icon="check"
              title="All stocked up"
              hint="Nothing is at or below its reorder point."
            />
          )}
          {data.categories.map((c: any) => {
            const t = catTint(c.category);
            return (
              <div key={c.category}>
                <h2 className="section-title">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ${t.tile}`}>
                    <Icon name={t.icon} size={14} />
                  </span>
                  {c.category}
                </h2>
                <div className="card overflow-x-auto p-0">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className={THEAD_ROW}>
                        <th className="px-4 py-3">Item</th>
                        <th className="px-4 py-3 text-right">Shop qty</th>
                        <th className="px-4 py-3 text-right">Reorder pt</th>
                        <th className="px-4 py-3 text-right">Suggested</th>
                        <th className="px-4 py-3 text-right">Last cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.items.map((i: any) => (
                        <tr key={i.item_id} className={BODY_ROW}>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2.5">
                              <ItemThumb item={i} shape="square" size={32} />
                              <span className="min-w-0">
                                <p className="truncate font-semibold">{i.name}</p>
                                <p className="truncate text-xs text-slate-400 dark:text-slate-500">{i.sku}</p>
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                              <Icon name="alert-triangle" size={14} />
                              {fmtQty(i.shop_qty, i.unit)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtQty(i.reorder_point, i.unit)}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {fmtQty(i.suggested_qty, i.unit)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(i.last_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {shaped && tab === "usage-by-tech" && (
        <div className="space-y-6">
          {data.techs.length === 0 && (
            <Empty icon="inbox" title="No usage in range" hint="Try a wider date range." />
          )}
          {data.techs.map((t: any, i: number) => (
            <div key={t.user_id}>
              <div className="mb-2.5 flex items-center gap-3">
                <Avatar name={t.user_name} index={t.user_id ?? i} size={36} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{t.user_name}</span>
                <span className="badge stat-number bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {fmtMoney(t.total_cost)}
                </span>
              </div>
              <UsageTable lines={t.lines} leadLabel="Job" leadField="job_number" />
            </div>
          ))}
        </div>
      )}

      {shaped && tab === "timesheet" && (
        <div className="space-y-6">
          {data.techs.length === 0 && (
            <Empty icon="clock" title="No shifts in range" hint="Try a wider date range." />
          )}
          {data.techs.map((t: any, i: number) => (
            <div key={t.user_id}>
              <div className="mb-2.5 flex items-center gap-3">
                <Avatar name={t.user_name} index={t.user_id ?? i} size={36} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{t.user_name}</span>
                <span className="badge stat-number bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {hoursLabel(t.total_hours)}
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className={THEAD_ROW}>
                      <th className="px-3 py-2">Job</th>
                      <th className="px-3 py-2">Clock In</th>
                      <th className="px-3 py-2">Clock Out</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.shifts.map((s: any) => (
                      <tr key={s.id} className={BODY_ROW}>
                        <td className="px-3 py-2">{s.job_number ?? "—"}</td>
                        <td className="px-3 py-2">{fmtWhen(s.clock_in_at)}</td>
                        <td className="px-3 py-2">
                          {s.still_clocked_in ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              Still clocked in
                            </span>
                          ) : (
                            fmtWhen(s.clock_out_at)
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {s.approval_status === "pending" ? (
                            <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                              Pending
                            </span>
                          ) : (
                            <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              Approved
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {hoursLabel(s.hours)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {shaped && tab === "usage-by-job" && (
        data.jobs.length === 0 ? (
          <Empty icon="inbox" title="No usage in range" hint="Try a wider date range." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {data.jobs.map((j: any) => (
                <button
                  key={j.job_id}
                  className={`chip ${jobTab === j.job_id ? "chip-active" : ""}`}
                  aria-pressed={jobTab === j.job_id}
                  onClick={() => setJobTab(j.job_id)}
                >
                  {j.job_number} — {j.job_name}
                </button>
              ))}
            </div>
            {data.jobs
              .filter((j: any) => j.job_id === jobTab)
              .map((j: any) => (
                <div key={j.job_id}>
                  <div className="mb-2.5 flex items-center gap-3">
                    <span className="icon-disc h-9 w-9 bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                      <Icon name="briefcase" size={18} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                      {j.job_number} — {j.job_name}
                    </span>
                    <span className="badge stat-number bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      {fmtMoney(j.total_cost)}
                    </span>
                  </div>
                  <UsageTable lines={j.lines} leadLabel="Tech" leadField="user_name" />
                </div>
              ))}
          </div>
        )
      )}

      {shaped && (tab === "receiving" || tab === "maurice") && (
        data.receiving.length === 0 ? (
          <Empty
            icon="inbox"
            title={tab === "maurice" ? "No Maurice orders in range" : "No receiving in range"}
            hint="Material received from vendors in this period will show here."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end gap-2">
              <span className="badge stat-number bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                {fmtMoney(data.total_tax)} tax
              </span>
              <span className="badge stat-number bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {fmtMoney(data.total_cost)} total
              </span>
            </div>
            <div className="card overflow-x-auto p-0">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className={THEAD_ROW}>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Unit cost</th>
                    <th className="px-4 py-3 text-right">Ext cost</th>
                    <th className="px-4 py-3 text-right">Tax</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.receiving.map((r: any) => (
                    <tr key={r.id} className={BODY_ROW}>
                      <td className="whitespace-nowrap px-4 py-3">{fmtWhen(r.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <ItemThumb item={r} shape="square" size={32} />
                          <span className="min-w-0">
                            <p className="truncate font-semibold">{r.item_name}</p>
                            <p className="truncate text-xs text-slate-400 dark:text-slate-500">{r.sku}</p>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtQty(r.qty, r.unit)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(r.unit_cost)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtMoney(r.ext_cost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-400 dark:text-slate-500">
                        {r.tax_amount ? fmtMoney(r.tax_amount) : "—"}
                      </td>
                      <td className="px-4 py-3">{r.vendor_name}</td>
                      <td className="px-4 py-3">{r.ref}</td>
                      <td className="max-w-[200px] truncate px-4 py-3" title={r.note}>
                        {r.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {shaped && tab === "adjustments" && (
        data.adjustments.length === 0 ? (
          <Empty
            icon="clipboard-list"
            title="No adjustments in range"
            hint="Stock adjustments recorded in this period will show here."
          />
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3">By</th>
                  <th className="px-4 py-3 text-right">Cost impact</th>
                </tr>
              </thead>
              <tbody>
                {data.adjustments.map((a: any) => (
                  <tr key={a.id} className={BODY_ROW}>
                    <td className="whitespace-nowrap px-4 py-3">{fmtWhen(a.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <ItemThumb item={a} shape="square" size={32} />
                        <span className="min-w-0">
                          <p className="truncate font-semibold">{a.item_name}</p>
                          <p className="truncate text-xs text-slate-400 dark:text-slate-500">{a.sku}</p>
                        </span>
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${
                        a.direction === "decrease"
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full ${
                            a.direction === "decrease"
                              ? "bg-red-100 dark:bg-red-500/15"
                              : "bg-emerald-100 dark:bg-emerald-500/15"
                          }`}
                        >
                          <Icon name={a.direction === "decrease" ? "minus" : "plus"} size={12} strokeWidth={2.5} />
                        </span>
                        {a.qty}
                      </span>
                    </td>
                    <td className="px-4 py-3">{a.location}</td>
                    <td className="px-4 py-3">{a.reason}</td>
                    <td className="max-w-[200px] truncate px-4 py-3" title={a.note}>
                      {a.note}
                    </td>
                    <td className="px-4 py-3">{a.user_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(a.cost_impact)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {shaped && tab === "pnl" && (
        <div className="space-y-4">
          {data.missing_rate_users.length > 0 && (
            <div className="alert-card">
              <span className="icon-disc bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400">
                <Icon name="alert-triangle" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-red-700 dark:text-red-300">
                  Labor cost may be understated
                </span>
                <span className="block text-[13px] text-red-600/80 dark:text-red-300/70">
                  No pay rate set for{" "}
                  {data.missing_rate_users
                    .map((m: any) => `${m.user_name} (${m.hours}h)`)
                    .join(", ")}
                  . Set a rate in Settings → Techs to include their hours.
                </span>
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Revenue", value: data.revenue, tint: "text-slate-900 dark:text-slate-100" },
              { label: "Materials", value: data.material_cost, tint: "text-slate-500 dark:text-slate-400" },
              { label: "Labor", value: data.labor_cost, tint: "text-slate-500 dark:text-slate-400" },
              { label: "Expenses", value: data.expense_cost, tint: "text-slate-500 dark:text-slate-400" },
              { label: "Overhead", value: data.overhead_expenses, tint: "text-slate-400 dark:text-slate-500" },
              {
                label: "Profit",
                value: data.profit,
                tint:
                  parseFloat(data.profit) >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400",
              },
            ].map((c) => (
              <div key={c.label} className="card p-3.5">
                <p className="section-title !mb-1">{c.label}</p>
                <p className={`stat-number text-[18px] ${c.tint}`}>{fmtMoney(c.value)}</p>
              </div>
            ))}
          </div>

          {data.by_job.length === 0 ? (
            <Empty icon="dollar-sign" title="No job activity in range" hint="Try a wider date range." />
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className={THEAD_ROW}>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3 text-right">Revenue</th>
                    <th className="px-4 py-3 text-right">Materials</th>
                    <th className="px-4 py-3 text-right">Labor</th>
                    <th className="px-4 py-3 text-right">Expenses</th>
                    <th className="px-4 py-3 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_job.map((j: any) => (
                    <tr key={j.job_id} className={BODY_ROW}>
                      <td className="px-4 py-3">
                        <span className="block truncate font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {j.job_number}
                        </span>
                        <span className="block truncate font-semibold">{j.job_name}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(j.revenue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(j.material_cost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(j.labor_cost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(j.expense_cost)}</td>
                      <td
                        className={`px-4 py-3 text-right font-semibold tabular-nums ${
                          parseFloat(j.profit) >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {fmtMoney(j.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UsageTable({ lines, leadLabel, leadField }: { lines: any[]; leadLabel: string; leadField: string }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className={THEAD_ROW}>
            <th className="px-4 py-3">{leadLabel}</th>
            <th className="px-4 py-3">Item</th>
            <th className="px-4 py-3 text-right">Out</th>
            <th className="px-4 py-3 text-right">Returned</th>
            <th className="px-4 py-3 text-right">Net</th>
            <th className="px-4 py-3 text-right">Net cost</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l: any, i: number) => (
            <tr key={i} className={BODY_ROW}>
              <td className="px-4 py-3">{l[leadField]}</td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-2.5">
                  <ItemThumb item={l} shape="square" size={32} />
                  <span className="min-w-0">
                    <p className="truncate font-semibold">{l.item_name}</p>
                    <p className="truncate text-xs text-slate-400 dark:text-slate-500">{l.sku}</p>
                  </span>
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtQty(l.qty_out, l.unit)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtQty(l.qty_returned, l.unit)}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtQty(l.net_qty, l.unit)}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtMoney(l.net_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
