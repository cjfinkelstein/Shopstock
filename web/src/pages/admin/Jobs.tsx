import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { api } from "../../api";
import Icon from "../../components/Icon";
import { Empty, ListSkeleton } from "../../components/ui";
import { useToast } from "../../toast";
import type { Job } from "../../types";

const EMPTY = { job_number: "", name: "", customer: "", address: "" };

const STATUS_SEGS: { value: string; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "", label: "All" },
];

export default function Jobs() {
  const toast = useToast();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Job | "new" | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);

  const load = useCallback(() => {
    api<Job[]>(`/jobs?status=${status}&search=${encodeURIComponent(search)}`)
      .then((r) => {
        setJobs(r);
        setLoaded(true);
      })
      .catch(() => {});
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    try {
      if (editing === "new") {
        await api("/jobs", { method: "POST", body: form });
        toast("success", "Job created");
      } else if (editing) {
        await api(`/jobs/${editing.id}`, { method: "PATCH", body: form });
        toast("success", "Job saved");
      }
      setEditing(null);
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    }
  };

  const F = (label: string, field: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="input"
        value={form[field] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
      />
    </label>
  );

  const countWord = status === "active" ? "active" : status === "closed" ? "closed" : "total";

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="page-eyebrow">
            Work{loaded ? ` · ${jobs.length} ${countWord}` : ""}
          </p>
          <h1 className="page-title">Jobs</h1>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setForm(EMPTY);
            setEditing("new");
          }}
        >
          <Icon name="plus" size={18} />
          New job
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-xs">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
          <input
            className="input pl-10"
            aria-label="Search jobs"
            placeholder="Search jobs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="seg w-full max-w-[280px]">
          {STATUS_SEGS.map((s) => (
            <button
              key={s.label}
              className={`seg-item ${status === s.value ? "seg-item-active" : ""}`}
              aria-pressed={status === s.value}
              onClick={() => setStatus(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <ListSkeleton rows={5} />
      ) : jobs.length === 0 ? (
        <Empty
          icon="briefcase"
          title="No jobs found"
          hint="Adjust the search or status filter, or start a new job."
        />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
          {jobs.map((j) => (
            <button
              key={j.id}
              className="card-interactive flex w-full items-center gap-3.5 p-3.5 text-left"
              onClick={() => navigate(`/admin/jobs/${j.id}`)}
            >
              <span className="icon-disc bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                <Icon name="briefcase" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {j.job_number}
                </span>
                <span className="block truncate text-[15px] font-semibold">{j.name}</span>
                {(j.customer || j.address) && (
                  <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">
                    {j.customer}
                    {j.address ? ` · ${j.address}` : ""}
                  </span>
                )}
              </span>
              <span
                className={`badge ${
                  j.status === "active"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {j.status}
              </span>
              <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
            </button>
          ))}
        </div>
      )}

      {editing && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing === "new" ? "New job" : "Edit job"}
          >
            <div className="mb-5 flex items-center gap-3">
              <span className="icon-tile bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                <Icon name="briefcase" size={20} />
              </span>
              <h2 className="text-lg font-bold tracking-tight">
                {editing === "new" ? "New job" : "Edit job"}
              </h2>
            </div>
            <div className="space-y-3.5">
              {F("Job number", "job_number")}
              {F("Name", "name")}
              {F("Customer", "customer")}
              {F("Address", "address")}
            </div>
            <div className="mt-6 flex gap-2.5">
              <button className="btn-secondary flex-1" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn-primary flex-1" onClick={save}>
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
