import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, fmtMoney } from "../../api";
import Icon from "../../components/Icon";
import { Empty, ListSkeleton } from "../../components/ui";
import { useToast } from "../../toast";
import type { Estimate, EstimateSummary } from "../../types";
import EstimateWizard from "./EstimateWizard";

const STATUS_TINT: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  sent: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  declined: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

export default function Estimates() {
  const toast = useToast();
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState<EstimateSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(() => {
    api<EstimateSummary[]>("/estimates")
      .then((r) => {
        setEstimates(r);
        setLoaded(true);
      })
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  const onCreated = (est: Estimate) => {
    setWizardOpen(false);
    toast("success", `${est.estimate_number} created`);
    navigate(`/admin/estimates/${est.id}`);
  };

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="page-eyebrow">Quoting</p>
          <h1 className="page-title">Estimates</h1>
        </div>
        <button className="btn-primary" onClick={() => setWizardOpen(true)}>
          <Icon name="plus" size={18} />
          New estimate
        </button>
      </div>

      {!loaded ? (
        <ListSkeleton rows={5} />
      ) : estimates.length === 0 ? (
        <Empty
          icon="clipboard-list"
          title="No estimates yet"
          hint="Walk through each section and pick what applies to get a draft materials list to start from."
        />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
          {estimates.map((e) => (
            <button
              key={e.id}
              className="card-interactive flex w-full items-center gap-3.5 p-3.5 text-left"
              onClick={() => navigate(`/admin/estimates/${e.id}`)}
            >
              <span className="icon-disc bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                <Icon name="clipboard-list" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {e.estimate_number}
                </span>
                <span className="block truncate text-[15px] font-semibold">{e.customer || "No customer name"}</span>
                <span className="block truncate text-[13px] font-bold text-slate-500 dark:text-slate-400">
                  {fmtMoney(e.total)}
                </span>
              </span>
              <span className={`badge ${STATUS_TINT[e.status]}`}>{e.status}</span>
              <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
            </button>
          ))}
        </div>
      )}

      {wizardOpen && <EstimateWizard onClose={() => setWizardOpen(false)} onCreated={onCreated} />}
    </div>
  );
}
