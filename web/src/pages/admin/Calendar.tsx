import { useCallback, useEffect, useState } from "react";

import { api, fmtQty } from "../../api";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { Empty, ItemThumb, ListSkeleton } from "../../components/ui";

interface LoginEntry {
  time: string;
  user_name: string;
  role: string;
}

interface SignOutEntry {
  time: string;
  item_name: string;
  sku: string | null;
  image_data?: string | null;
  qty: string;
  unit: string;
  job_name: string | null;
  job_number: string | null;
  user_name: string;
}

interface DayData {
  logins: LoginEntry[];
  sign_outs: SignOutEntry[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Calendar() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [days, setDays] = useState<Record<string, DayData> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    setDays(null);
    const from = toISODate(month);
    const to = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    api<{ days: Record<string, DayData> }>(`/reports/calendar?date_from=${from}&date_to=${to}`)
      .then((r) => setDays(r.days))
      .catch(() => {});
  }, [month]);

  useEffect(load, [load]);

  const today = toISODate(new Date());
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const shiftMonth = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const selectedData = selected && days ? days[selected] : null;

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-eyebrow">Activity</p>
          <h1 className="page-title">Calendar</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            <Icon name="arrow-left" size={18} />
          </button>
          <span className="min-w-[150px] text-center text-[15px] font-bold">{monthLabel}</span>
          <button className="icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
            <Icon name="arrow-right" size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[13px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
          Logins
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          Signed out
        </span>
      </div>

      {!days ? (
        <ListSkeleton rows={5} height={90} />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-800">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500"
              >
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (day === null) return <div key={i} className="min-h-[92px] border-b border-r border-slate-100 last:border-r-0 dark:border-slate-800" />;
              const iso = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const d = days[iso];
              const hasData = d && (d.logins.length > 0 || d.sign_outs.length > 0);
              const isToday = iso === today;
              const summaryLines = hasData
                ? [
                    ...d.logins.map((l, li) => ({ key: `l${li}-${l.time}${l.user_name}`, dot: "bg-brand-500", text: `${l.user_name} logged in` })),
                    ...d.sign_outs.map((s, si) => ({ key: `s${si}-${s.time}${s.item_name}`, dot: "bg-amber-500", text: `${fmtQty(s.qty, s.unit)} ${s.item_name}` })),
                  ]
                : [];
              const shown = summaryLines.slice(0, 3);
              const hiddenCount = summaryLines.length - shown.length;
              return (
                <button
                  key={i}
                  onClick={() => hasData && setSelected(iso)}
                  disabled={!hasData}
                  className={`flex min-h-[92px] flex-col items-start gap-1 border-b border-r p-2 text-left transition-colors last:border-r-0 dark:border-slate-800 md:min-h-[132px] lg:min-h-[150px] ${
                    hasData ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" : "cursor-default"
                  } ${(i + 1) % 7 === 0 ? "border-r-0" : "border-slate-100"}`}
                >
                  <span className="flex w-full items-center justify-between">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold ${
                        isToday
                          ? "bg-brand-600 text-white"
                          : "text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {day}
                    </span>
                    {hasData && (
                      <span className="flex gap-1 md:hidden">
                        {d.logins.length > 0 && (
                          <span className="badge bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                            {d.logins.length}
                          </span>
                        )}
                        {d.sign_outs.length > 0 && (
                          <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            {d.sign_outs.length}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  {shown.length > 0 && (
                    <span className="hidden w-full min-w-0 flex-col gap-0.5 md:flex">
                      {shown.map((line) => (
                        <span key={line.key} className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${line.dot}`} />
                          <span className="truncate">{line.text}</span>
                        </span>
                      ))}
                      {hiddenCount > 0 && (
                        <span className="pl-3 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                          +{hiddenCount} more
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <Sheet
          title={new Date(selected + "T00:00:00").toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric", year: "numeric",
          })}
          onClose={() => setSelected(null)}
        >
          <div className="space-y-5">
            <div>
              <h2 className="section-title">
                <Icon name="users" size={14} />
                Logins ({selectedData?.logins.length ?? 0})
              </h2>
              {selectedData && selectedData.logins.length > 0 ? (
                <div className="space-y-2">
                  {selectedData.logins.map((l, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-slate-800/60">
                      <span className="font-semibold">{l.user_name}</span>
                      <span className="flex items-center gap-2 text-[13px] text-slate-400 dark:text-slate-500">
                        {l.role === "admin" && (
                          <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            admin
                          </span>
                        )}
                        {l.time}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty icon="users" title="No logins" hint="Nobody tapped in this day." />
              )}
            </div>

            <div>
              <h2 className="section-title">
                <Icon name="package" size={14} />
                Signed out ({selectedData?.sign_outs.length ?? 0})
              </h2>
              {selectedData && selectedData.sign_outs.length > 0 ? (
                <div className="space-y-2">
                  {selectedData.sign_outs.map((s, i) => (
                    <div key={i} className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-slate-800/60">
                      <ItemThumb item={{ image_data: s.image_data }} shape="square" size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">{s.item_name}</span>
                          <span className="shrink-0 text-[13px] font-semibold text-slate-500 dark:text-slate-400">{s.time}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-slate-400 dark:text-slate-500">
                          <span>{fmtQty(s.qty, s.unit)}</span>
                          <span>·</span>
                          <span>{s.user_name}</span>
                          {s.job_name && (
                            <>
                              <span>·</span>
                              <span>{s.job_number} {s.job_name}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty icon="package" title="Nothing signed out" hint="No material left the shop this day." />
              )}
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
