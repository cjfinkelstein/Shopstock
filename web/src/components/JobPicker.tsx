import { useEffect, useState } from "react";

import { api } from "../api";
import Icon from "./Icon";
import { Empty } from "./ui";
import type { Job } from "../types";

interface Props {
  onPick: (job: Job) => void;
}

/** 5 most recent jobs first, then a searchable list of active jobs. */
export default function JobPicker({ onPick }: Props) {
  const [recent, setRecent] = useState<Job[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");

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
