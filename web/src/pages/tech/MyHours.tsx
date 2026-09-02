import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, fmtWhen } from "../../api";
import Icon from "../../components/Icon";
import { Empty, ListSkeleton } from "../../components/ui";
import { hoursLabel } from "../../hours";

interface Shift {
  id: number;
  clock_in_at: string;
  clock_out_at: string | null;
  still_clocked_in: boolean;
  hours: number;
  job_number: string | null;
  job_name: string | null;
}

export default function MyHours() {
  const navigate = useNavigate();
  const [shifts, setShifts] = useState<Shift[] | null>(null);

  useEffect(() => {
    api<Shift[]>("/time/my-shifts").then(setShifts).catch(() => setShifts([]));
  }, []);

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
                  <p className="text-[13.5px] font-semibold">{fmtWhen(s.clock_in_at)}</p>
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
    </div>
  );
}
