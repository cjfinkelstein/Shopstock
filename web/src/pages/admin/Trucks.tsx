import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api, fmtQty } from "../../api";
import Icon from "../../components/Icon";
import { Empty, ItemThumb, ListSkeleton, Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import type { Job, StockRow, Truck } from "../../types";

export default function Trucks() {
  const toast = useToast();
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Truck | null>(null);
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [assigning, setAssigning] = useState<StockRow | null>(null);
  const [qty, setQty] = useState("");
  const [jobId, setJobId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Truck[]>("/trucks").then((r) => {
      setTrucks(r);
      setLoaded(true);
    }).catch(() => {});
    api<Job[]>("/jobs?status=active").then(setJobs).catch(() => {});
  }, []);

  useEffect(load, [load]);

  const openTruck = (truck: Truck) => {
    setSelected(truck);
    setStock(null);
    if (truck.location) {
      api<StockRow[]>(`/stock?location_id=${truck.location.id}`).then(setStock).catch(() => {});
    } else {
      setStock([]);
    }
  };

  const openAssign = (row: StockRow) => {
    setAssigning(row);
    setQty(row.qty);
    setJobId(jobs[0] ? String(jobs[0].id) : "");
  };

  const confirmAssign = async () => {
    if (!assigning || !selected?.location || !jobId) return;
    setSaving(true);
    try {
      await api("/transactions/sign-out", {
        method: "POST",
        body: {
          item_id: assigning.item_id,
          qty,
          from_location_id: selected.location.id,
          job_id: Number(jobId),
        },
      });
      toast("success", `Assigned ${fmtQty(qty, assigning.unit)} ${assigning.name} to a job`);
      setAssigning(null);
      openTruck(selected);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not assign to job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <p className="page-eyebrow">Fleet</p>
        <h1 className="page-title">Trucks</h1>
      </div>

      {!loaded ? (
        <ListSkeleton rows={4} />
      ) : trucks.length === 0 ? (
        <Empty icon="truck" title="No trucks yet" hint="Add trucks in Settings." />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
          {trucks.map((t) => (
            <button
              key={t.id}
              onClick={() => openTruck(t)}
              className={`card-interactive flex w-full items-center gap-3.5 p-3.5 text-left ${
                selected?.id === t.id ? "border-brand-500 ring-2 ring-brand-500/20 dark:border-brand-500" : ""
              }`}
            >
              <span className="icon-disc bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                <Icon name="truck" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{t.name}</span>
              </span>
              <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title mb-0">
              <Icon name="truck" size={14} />
              {selected.name} — what&apos;s on board
            </h2>
            <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>

          {stock === null ? (
            <ListSkeleton rows={3} />
          ) : stock.length === 0 ? (
            <Empty icon="package" title="Nothing on this truck" hint="Load it from an item's Take Out flow." />
          ) : (
            <div className="space-y-2">
              {stock.map((row) => {
                return (
                  <div key={row.item_id} className="flex items-center gap-3 rounded-2xl bg-slate-50/70 p-3 dark:bg-slate-800/50">
                    <ItemThumb item={row} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{row.name}</span>
                      <span className="block truncate text-[12px] text-slate-400 dark:text-slate-500">
                        {row.sku} · {fmtQty(row.qty, row.unit)} on hand
                      </span>
                    </span>
                    <button className="btn-secondary shrink-0" onClick={() => openAssign(row)}>
                      <Icon name="briefcase" size={16} />
                      Assign to job
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {assigning && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setAssigning(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Assign to job"
          >
            <div className="mb-5">
              <p className="page-eyebrow">Assign to job</p>
              <h2 className="text-lg font-bold tracking-tight">{assigning.name}</h2>
              <p className="text-sm text-slate-400 dark:text-slate-500">
                {selected?.name} · {fmtQty(assigning.qty, assigning.unit)} on hand
              </p>
            </div>
            <div className="space-y-3.5">
              <label className="block">
                <span className="label">Quantity</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="any"
                  max={assigning.qty}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="label">Job</span>
                <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.job_number} — {j.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-6 flex gap-2.5">
              <button className="btn-secondary flex-1" onClick={() => setAssigning(null)}>
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                disabled={saving || !qty || Number(qty) <= 0 || !jobId}
                onClick={confirmAssign}
              >
                {saving ? <Spinner /> : null}
                Confirm
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
