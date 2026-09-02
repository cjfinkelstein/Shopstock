import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { fmtMoney, publicApi } from "../api";
import Icon from "../components/Icon";
import { Empty, PageLoader, Spinner } from "../components/ui";
import type { PublicEstimate as PublicEstimateType } from "../types";

const STATUS_LABEL: Record<string, string> = {
  approved: "approved",
  declined: "declined",
};

export default function PublicEstimate() {
  const { token } = useParams();
  const [estimate, setEstimate] = useState<PublicEstimateType | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    publicApi<PublicEstimateType>(`/public/estimates/${token}`)
      .then(setEstimate)
      .catch(() => setNotFound(true));
  }, [token]);

  useEffect(load, [load]);

  const respond = async (decision: "approved" | "declined") => {
    if (!token) return;
    setResponding(true);
    setError(null);
    try {
      const updated = await publicApi<PublicEstimateType>(`/public/estimates/${token}/respond`, {
        method: "POST",
        body: { decision },
      });
      setEstimate(updated);
      setConfirmingDecline(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setResponding(false);
    }
  };

  if (notFound) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Empty
          icon="alert-triangle"
          title="Estimate not found"
          hint="This link may be out of date. Check the email again, or contact us directly."
        />
      </div>
    );
  }

  if (!estimate) return <PageLoader />;

  const alreadyResponded = estimate.status === "approved" || estimate.status === "declined";

  return (
    <div className="mx-auto min-h-full max-w-lg px-4 py-10 sm:py-14">
      <p className="page-eyebrow font-mono">{estimate.estimate_number}</p>
      <h1 className="page-title mb-1">APEX Electrical Group</h1>
      {(estimate.customer || estimate.address) && (
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          {estimate.customer}
          {estimate.address ? ` · ${estimate.address}` : ""}
        </p>
      )}

      {alreadyResponded && (
        <div
          className={`card mb-5 flex items-center gap-3 p-4 ${
            estimate.status === "approved"
              ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10"
              : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60"
          }`}
        >
          <Icon
            name={estimate.status === "approved" ? "check" : "x"}
            size={20}
            className={estimate.status === "approved" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500"}
          />
          <p className="text-sm font-semibold">You've already {STATUS_LABEL[estimate.status]} this estimate.</p>
        </div>
      )}

      <div className="space-y-5">
        {estimate.sections.map((section) => (
          <div key={section.name} className="card p-4">
            <p className="section-title !mb-2">
              <Icon name="package" size={14} />
              {section.name}
            </p>
            <ul className="space-y-1.5">
              {section.lines.map((line, i) => (
                <li key={i} className="flex justify-between gap-3 text-[14px]">
                  <span className="text-slate-700 dark:text-slate-200">{line.description}</span>
                  <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">
                    {line.qty} {line.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {estimate.exclusions && estimate.exclusions.trim() && (
          <div className="card p-4">
            <p className="section-title !mb-2">
              <Icon name="x" size={14} />
              Exclusions
            </p>
            <p className="whitespace-pre-line text-[14px] text-slate-500 dark:text-slate-400">
              {estimate.exclusions}
            </p>
          </div>
        )}

        <div className="card flex items-center justify-between p-4">
          <span className="text-[16px] font-bold">Total</span>
          <span className="stat-number text-[22px] text-emerald-600 dark:text-emerald-400">
            {fmtMoney(estimate.total)}
          </span>
        </div>

        {!alreadyResponded && (
          <div className="space-y-2.5">
            {error && (
              <p className="rounded-xl bg-red-50 p-3 text-[13px] font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </p>
            )}
            {confirmingDecline ? (
              <div className="card space-y-3 p-4">
                <p className="text-[14px] font-semibold">Decline this estimate?</p>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary flex-1"
                    disabled={responding}
                    onClick={() => setConfirmingDecline(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-danger flex-1"
                    disabled={responding}
                    onClick={() => respond("declined")}
                  >
                    {responding ? <Spinner /> : <Icon name="x" size={16} />}
                    Yes, decline
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  className="btn-primary w-full"
                  disabled={responding}
                  onClick={() => respond("approved")}
                >
                  {responding ? <Spinner /> : <Icon name="check" size={18} />}
                  Approve
                </button>
                <button
                  className="btn-secondary w-full"
                  disabled={responding}
                  onClick={() => setConfirmingDecline(true)}
                >
                  <Icon name="x" size={18} />
                  Decline
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
