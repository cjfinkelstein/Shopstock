import { useCallback, useEffect, useState } from "react";

import { api, downloadCsv, fmtMoney } from "../../api";
import ExpenseSheet from "../../components/ExpenseSheet";
import Icon from "../../components/Icon";
import { Empty, ListSkeleton } from "../../components/ui";
import { useToast } from "../../toast";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "../../types";
import type { Expense, Job } from "../../types";

const CATEGORY_TINT: Record<string, string> = {
  fuel: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  tools_equipment: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  permits_fees: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  subcontractor: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  office_admin: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  insurance: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400",
  travel: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  misc: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
};

export default function Expenses() {
  const toast = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [editing, setEditing] = useState<Expense | "new" | null>(null);

  const query = () => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (category) p.set("category", category);
    if (jobFilter) p.set("job_id", jobFilter);
    return p.toString();
  };

  const load = useCallback(() => {
    api<Expense[]>(`/expenses?${query()}`)
      .then((r) => {
        setExpenses(r);
        setLoaded(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, category, jobFilter]);

  useEffect(load, [load]);
  useEffect(() => {
    api<Job[]>("/jobs?status=&search=").then(setJobs).catch(() => {});
  }, []);

  const remove = async (e: Expense) => {
    if (!confirm(`Delete this ${fmtMoney(e.amount)} expense?`)) return;
    try {
      await api(`/expenses/${e.id}`, { method: "DELETE" });
      toast("success", "Expense deleted");
      load();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Delete failed");
    }
  };

  const total = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="page-eyebrow">{loaded ? `${expenses.length} entries · ${fmtMoney(total)}` : ""}</p>
          <h1 className="page-title">Expenses</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            onClick={() => downloadCsv(`/expenses?${query()}&format=csv`, "expenses.csv")}
          >
            <Icon name="download" size={18} />
            CSV
          </button>
          <button className="btn-primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={18} />
            Add expense
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="block">
          <span className="label">From</span>
          <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">To</span>
          <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Job</span>
          <select className="input" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
            <option value="">All</option>
            <option value="none">Overhead (no job)</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_number} — {j.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!loaded ? (
        <ListSkeleton rows={5} />
      ) : expenses.length === 0 ? (
        <Empty
          icon="dollar-sign"
          title="No expenses found"
          hint="Adjust the filters, or add your first expense."
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                >
                  <td className="whitespace-nowrap px-4 py-3">{e.expense_date}</td>
                  <td className="px-4 py-3">
                    <span className={`badge w-fit ${CATEGORY_TINT[e.category] ?? ""}`}>
                      {EXPENSE_CATEGORY_LABELS[e.category]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {e.job_number ? (
                      <span className="font-mono text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                        {e.job_number}
                      </span>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">Overhead</span>
                    )}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-slate-500 dark:text-slate-400">
                    {e.notes || "—"}
                    {e.has_receipt && <Icon name="file-text" size={13} className="ml-1.5 inline text-slate-400" />}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtMoney(e.amount)}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center justify-end gap-1">
                      <button className="icon-btn" aria-label="Edit" onClick={() => setEditing(e)}>
                        <Icon name="pencil" size={15} />
                      </button>
                      <button className="icon-btn" aria-label="Delete" onClick={() => remove(e)}>
                        <Icon name="trash" size={15} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ExpenseSheet
          expense={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
