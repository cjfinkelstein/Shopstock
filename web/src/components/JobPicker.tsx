import { useEffect, useState } from "react";

import { api } from "../api";
import Icon from "./Icon";
import { Empty, Spinner } from "./ui";
import type { Job } from "../types";

interface Props {
  onPick: (job: Job) => void;
  /** Shows a "+ Create new job" row that lets the user type a brand-new job
   * name and select it immediately -- used where the job might not exist
   * in the system yet (e.g. clocking in at a new site). */
  allowCreate?: boolean;
}

/** 5 most recent jobs first, then a searchable list of active jobs. */
export default function JobPicker({ onPick, allowCreate }: Props) {
  const [recent, setRecent] = useState<Job[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Job[]>("/jobs/recent").then(setRecent).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api<Job[]>(`/jobs?status=active&search=${encodeURIComponent(search)}`)
        .then(setJobs)
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const recentIds = new Set(recent.map((j) => j.id));
  const rest = jobs.filter((j) => !recentIds.has(j.id) || search);

  const createJob = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const job = await api<Job>("/jobs", { method: "POST", body: { name } });
      onPick(job);
    } finally {
      setBusy(false);
    }
  };

  const JobButton = ({ job }: { job: Job }) => (
    <button type="button" onClick={() => onPick(job)} className="card-interactive flex w-full items-center gap-3 p-3.5">
      <span className="icon-tile bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
        <Icon name="briefcase" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{job.name}</span>
        <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">
          {job.job_number}
          {job.customer ? ` · ${job.customer}` : ""}
        </span>
      </span>
      <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
        />
        <input
          className="input pl-11"
          aria-label="Search jobs"
          placeholder="Search jobs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {allowCreate &&
        (creating ? (
          <div className="card space-y-2.5 p-3.5">
            <label className="block">
              <span className="label">New job name</span>
              <input
                className="input"
                autoFocus
                placeholder="e.g. 22 Oak Street"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createJob()}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={busy || !newName.trim()}
                onClick={createJob}
              >
                {busy ? <Spinner /> : <Icon name="check" size={16} />}
                Create &amp; Select
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="card-interactive flex w-full items-center gap-3 border-dashed p-3.5"
          >
            <span className="icon-tile bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
              <Icon name="plus" size={20} />
            </span>
            <span className="text-[15px] font-semibold">Create new job</span>
          </button>
        ))}

      {!search && recent.length > 0 && (
        <>
          <p className="section-title flex items-center gap-1.5 px-1">
            <Icon name="history" size={14} />
            Recent
          </p>
          <div className="space-y-2.5">
            {recent.map((j) => (
              <JobButton key={j.id} job={j} />
            ))}
          </div>
          <p className="section-title flex items-center gap-1.5 px-1 pt-1">
            <Icon name="briefcase" size={14} />
            All active jobs
          </p>
        </>
      )}
      <div className="space-y-2.5">
        {rest.map((j) => (
          <JobButton key={j.id} job={j} />
        ))}
        {rest.length === 0 && recent.length === 0 && (
          <Empty icon="briefcase" title="No jobs found" hint="Try a different name or job number." />
        )}
      </div>
    </div>
  );
}
