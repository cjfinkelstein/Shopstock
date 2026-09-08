import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, fmtWhen } from "../../api";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { Empty, ListSkeleton, Spinner } from "../../components/ui";
import { hoursLabel } from "../../hours";
import { useToast } from "../../toast";
import type { PtoBalance } from "../../types";

interface Shift {
  id: number;
  clock_in_at: string;
  clock_out_at: string | null;
  still_clocked_in: boolean;
  hours: number;
  job_number: string | null;
  job_name: string | null;
  approval_status: string;
}

const PTO_STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  denied: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};

export default function MyHours() {
  const navigate = useNavigate();
  const toast = useToast();
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [pto, setPto] = useState<PtoBalance | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqStart, setReqStart] = useState("");
  const [reqEnd, setReqEnd] = useState("");
  const [reqCategory, setReqCategory] = useState<"vacation" | "personal">("vacation");
  const [reqNotes, setReqNotes] = useState("");
  const [reqSaving, setReqSaving] = useState(false);

  useEffect(() => {
    api<Shift[]>("/time/my-shifts").then(setShifts).catch(() => setShifts([]));
  }, []);

  const loadPto = useCallback(() => {
    api<PtoBalance>("/pto/balance").then(setPto).catch(() => {});
  }, []);

  useEffect(loadPto, [loadPto]);

  const closeRequest = () => {
    setRequestOpen(false);
    setReqStart("");
    setReqEnd("");
    setReqCategory("vacation");
    setReqNotes("");
  };

  const submitRequest = async () => {
    if (!reqStart || !reqEnd) return;
    setReqSaving(true);
    try {
      await api("/pto/request", {
        method: "POST",
        body: { start_date: reqStart, end_date: reqEnd, category: reqCategory, notes: reqNotes.trim() || null },
      });
      toast("success", "Time off requested — waiting on admin approval");
      closeRequest();
      loadPto();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not submit request");
    } finally {
      setReqSaving(false);
    }
  };

  const totalHours = shifts?.reduce((sum, s) => sum + s.hours, 0) ?? 0;

  return (
    <div className="space-y-5 animate-fade-up">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="-ml-1.5 rounded-full p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
        >
          <Icon name="arrow-left" size={20} />
        </button>
        <div>
          <p className="page-eyebrow">My hours</p>
          <h1 className="page-title mt-1">Timesheet</h1>
        </div>
      </header>

      {pto && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-emerald-50 p-3.5 text-center dark:bg-emerald-500/10">
              <p className="text-[24px] font-extrabold text-emerald-700 dark:text-emerald-300">
                {pto.vacation_remaining}
              </p>
              <p className="text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                of {pto.vacation_allotted} vacation days left
              </p>
              {Number(pto.vacation_pending) > 0 && (
                <p className="mt-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  {pto.vacation_pending} pending
                </p>
              )}
            </div>
            <div className="rounded-2xl bg-brand-50 p-3.5 text-center dark:bg-brand-500/10">
              <p className="text-[24px] font-extrabold text-brand-700 dark:text-brand-300">
                {pto.personal_remaining}
              </p>
              <p className="text-[11.5px] font-semibold text-brand-600 dark:text-brand-400">
                of {pto.personal_allotted} personal days left
              </p>
              {Number(pto.personal_pending) > 0 && (
                <p className="mt-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  {pto.personal_pending} pending
                </p>
              )}
            </div>
          </div>

          <button className="btn-secondary w-full" onClick={() => setRequestOpen(true)}>
            <Icon name="calendar" size={18} />
            Request time off
          </button>

          {pto.entries.length > 0 && (
            <div className="space-y-2">
              <p className="section-title !mb-0">
                <Icon name="calendar" size={14} />
                My PTO requests
              </p>
              {pto.entries.map((e) => (
                <div key={e.id} className="card flex items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13.5px] font-semibold capitalize">{e.category}</p>
                      <span className={`badge shrink-0 capitalize ${PTO_STATUS_BADGE[e.status]}`}>{e.status}</span>
                    </div>
                    <p className="truncate text-[12px] text-slate-500 dark:text-slate-400">
                      {e.entry_date}
                      {e.end_date && e.end_date !== e.entry_date ? ` – ${e.end_date}` : ""}
                      {e.notes ? ` · ${e.notes}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[14px] font-bold tabular-nums">{e.days}d</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {shifts === null ? (
        <ListSkeleton rows={5} />
      ) : shifts.length === 0 ? (
        <Empty icon="clock" title="No shifts yet" hint="Your clock-in history will show up here." />
      ) : (
        <>
          <div className="card flex items-center justify-between p-3.5">
            <span className="text-[13.5px] font-semibold">Total hours (last 200 shifts)</span>
            <span className="badge stat-number bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {hoursLabel(totalHours)}
            </span>
          </div>

          <div className="space-y-2">
            {shifts.map((s) => (
              <div key={s.id} className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13.5px] font-semibold">{fmtWhen(s.clock_in_at)}</p>
                    {s.approval_status === "pending" ? (
                      <span className="badge shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        Pending
                      </span>
                    ) : (
                      <span className="badge shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        Approved
                      </span>
                    )}
                  </div>
                  {s.job_number && (
                    <p className="truncate text-[12px] font-medium text-brand-600 dark:text-brand-400">
                      {s.job_number}
                      {s.job_name ? ` — ${s.job_name}` : ""}
                    </p>
                  )}
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">
                    {s.still_clocked_in ? (
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        Still clocked in
                      </span>
                    ) : (
                      `Out ${fmtWhen(s.clock_out_at!)}`
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-[14px] font-bold tabular-nums">{hoursLabel(s.hours)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {requestOpen && (
        <Sheet title="Request time off" subtitle="Sent to your admin for approval" onClose={closeRequest}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="label">From</span>
                <input
                  type="date"
                  className="input"
                  value={reqStart}
                  onChange={(e) => setReqStart(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="label">To</span>
                <input type="date" className="input" value={reqEnd} onChange={(e) => setReqEnd(e.target.value)} />
              </label>
            </div>
            <label className="block">
              <span className="label">Type</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`chip flex-1 !justify-center ${reqCategory === "vacation" ? "chip-active" : ""}`}
                  onClick={() => setReqCategory("vacation")}
                >
                  Vacation
                </button>
                <button
                  type="button"
                  className={`chip flex-1 !justify-center ${reqCategory === "personal" ? "chip-active" : ""}`}
                  onClick={() => setReqCategory("personal")}
                >
                  Personal
                </button>
              </div>
            </label>
            <label className="block">
              <span className="label">Notes (optional)</span>
              <input
                className="input"
                placeholder="e.g. Family trip"
                value={reqNotes}
                onChange={(e) => setReqNotes(e.target.value)}
              />
            </label>
            <button
              className="btn-primary w-full"
              disabled={reqSaving || !reqStart || !reqEnd}
              onClick={submitRequest}
            >
              {reqSaving ? <Spinner /> : <Icon name="calendar" size={18} />}
              Submit request
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
