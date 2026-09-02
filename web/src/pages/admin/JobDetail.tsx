import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api, downloadCsv, fmtMoney, fmtQty, fmtWhen } from "../../api";
import ExpenseSheet from "../../components/ExpenseSheet";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { Empty, ItemThumb, PageLoader, Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import { EXPENSE_CATEGORY_LABELS } from "../../types";
import type { EstimateSummary, Expense, JobCostingOut, JobFile, JobFileMeta, JobMaterialsOut } from "../../types";
import EstimateWizard from "./EstimateWizard";

const REVENUE_KIND_LABEL: Record<string, string> = {
  deposit: "Deposit",
  progress: "Progress payment",
  final: "Final payment",
  other: "Other",
};

function AddRevenueSheet({ jobId, onClose, onSaved }: { jobId: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("deposit");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!date || !amount) {
      toast("error", "Date and amount are required");
      return;
    }
    setBusy(true);
    try {
      await api(`/jobs/${jobId}/revenues`, {
        method: "POST",
        body: { received_date: date, amount, kind, ref: ref.trim() || null, notes: notes.trim() || null },
      });
      toast("success", "Revenue added");
      onSaved();
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Add revenue" subtitle="A payment received against this job" onClose={onClose}>
      <div className="space-y-3.5 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Date</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Amount</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="input"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="label">Kind</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(REVENUE_KIND_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Reference (optional)</span>
          <input className="input" placeholder="Invoice #, check #…" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Notes</span>
          <textarea
            className="input min-h-[72px] resize-none"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <button className="btn-primary w-full" disabled={busy} onClick={save}>
          {busy ? <Spinner /> : <Icon name="check" size={18} />}
          Add revenue
        </button>
      </div>
    </Sheet>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Photo grid item -- fetches its full image data lazily, only once it scrolls near the
 * viewport, so opening a job with hundreds of photos doesn't try to load them all at once. */
function LazyPhoto({ file, onRemove }: { file: JobFileMeta; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          api<JobFile>(`/jobs/files/${file.id}`).then((f) => setSrc(f.data)).catch(() => {});
          obs.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [file.id]);

  return (
    <div ref={ref} className="group relative overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800">
      {src ? (
        <a href={src} target="_blank" rel="noreferrer">
          <img src={src} alt={file.filename} className="aspect-square w-full object-cover" />
        </a>
      ) : (
        <div className="aspect-square w-full animate-pulse" />
      )}
      <button
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
        onClick={onRemove}
        aria-label={`Remove ${file.filename}`}
      >
        <Icon name="x" size={14} />
      </button>
      <p className="truncate bg-slate-950/60 px-2 py-1 text-[11px] text-white">{file.filename}</p>
    </div>
  );
}

type Tab = "items" | "activity" | "costing" | "estimates" | "files";

const STATUS_TINT: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  sent: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  declined: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB -- generous for a photo/PDF, guards against accidental huge uploads

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<JobMaterialsOut | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const [estimates, setEstimates] = useState<EstimateSummary[] | null>(null);
  const [files, setFiles] = useState<JobFileMeta[] | null>(null);
  const [costing, setCosting] = useState<JobCostingOut | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [addRevenueOpen, setAddRevenueOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<JobMaterialsOut>(`/jobs/${id}/materials`).then(setData).catch(() => navigate("/admin/jobs"));
  }, [id, navigate]);

  const loadEstimates = useCallback(() => {
    api<EstimateSummary[]>(`/estimates?job_id=${id}`).then(setEstimates).catch(() => {});
  }, [id]);

  const loadFiles = useCallback(() => {
    api<JobFileMeta[]>(`/jobs/${id}/files`).then(setFiles).catch(() => {});
  }, [id]);

  const loadCosting = useCallback(() => {
    api<JobCostingOut>(`/jobs/${id}/costing`).then(setCosting).catch(() => {});
  }, [id]);

  useEffect(load, [load]);
  useEffect(loadEstimates, [loadEstimates]);
  useEffect(loadFiles, [loadFiles]);
  useEffect(loadCosting, [loadCosting]);

  const handleFilesPicked = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > MAX_FILE_BYTES) {
          toast("error", `${file.name} is too big (max 15MB)`);
          continue;
        }
        const dataUrl = await readAsDataUrl(file);
        const kind = file.type.startsWith("image/") ? "photo" : "document";
        await api(`/jobs/${id}/files`, {
          method: "POST",
          body: { kind, filename: file.name, mime_type: file.type || "application/octet-stream", data: dataUrl },
        });
      }
      toast("success", "Uploaded");
      loadFiles();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = async (fileId: number) => {
    if (!confirm("Remove this file?")) return;
    await api(`/jobs/files/${fileId}`, { method: "DELETE" });
    setFiles((f) => f?.filter((x) => x.id !== fileId) ?? null);
  };

  const downloadFile = async (f: JobFileMeta) => {
    setDownloadingId(f.id);
    try {
      const full = await api<JobFile>(`/jobs/files/${f.id}`);
      const a = document.createElement("a");
      a.href = full.data;
      a.download = full.filename;
      a.click();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not load file");
    } finally {
      setDownloadingId(null);
    }
  };

  if (!data) return <PageLoader />;
  const { job, lines, activity, total_cost } = data;

  const toggleStatus = async () => {
    await api(`/jobs/${job.id}`, {
      method: "PATCH",
      body: { status: job.status === "active" ? "closed" : "active" },
    });
    toast("success", job.status === "active" ? "Job closed" : "Job reopened");
    load();
  };

  return (
    <div className="space-y-5 animate-fade-up">
      <button onClick={() => navigate("/admin/jobs")} className="btn-ghost -ml-3 px-3">
        <Icon name="arrow-left" size={18} />
        Jobs
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 shadow-card dark:bg-amber-500/15 dark:text-amber-400">
            <Icon name="briefcase" size={26} />
          </span>
          <div className="min-w-0">
            <p className="page-eyebrow font-mono">{job.job_number}</p>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="page-title">{job.name}</h1>
              <span
                className={`badge ${
                  job.status === "active"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {job.status}
              </span>
            </div>
            {(job.customer || job.address) && (
              <p className="mt-0.5 text-sm text-slate-400 dark:text-slate-500">
                {job.customer}
                {job.address ? ` · ${job.address}` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            onClick={() => downloadCsv(`/jobs/${job.id}/materials?format=csv`, `${job.job_number}-materials.csv`)}
          >
            <Icon name="download" size={18} />
            CSV
          </button>
          <button className="btn-secondary" onClick={toggleStatus}>
            {job.status === "active" ? "Close job" : "Reopen job"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className={`chip ${tab === "items" ? "chip-active" : ""}`}
          aria-pressed={tab === "items"}
          onClick={() => setTab("items")}
        >
          Items
        </button>
        <button
          className={`chip ${tab === "activity" ? "chip-active" : ""}`}
          aria-pressed={tab === "activity"}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
        <button
          className={`chip ${tab === "costing" ? "chip-active" : ""}`}
          aria-pressed={tab === "costing"}
          onClick={() => setTab("costing")}
        >
          Cost &amp; Profit
        </button>
        <button
          className={`chip ${tab === "estimates" ? "chip-active" : ""}`}
          aria-pressed={tab === "estimates"}
          onClick={() => setTab("estimates")}
        >
          Estimates
          {estimates && estimates.length > 0 ? ` (${estimates.length})` : ""}
        </button>
        <button
          className={`chip ${tab === "files" ? "chip-active" : ""}`}
          aria-pressed={tab === "files"}
          onClick={() => setTab("files")}
        >
          Photos &amp; Documents
          {files && files.length > 0 ? ` (${files.length})` : ""}
        </button>
      </div>

      {tab === "items" && (lines.length === 0 ? (
        <div className="card p-0">
          <Empty
            icon="package"
            title="No materials yet"
            hint="Materials signed out to this job will show up here."
          />
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[740px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3 text-right">Signed out</th>
                <th className="px-4 py-3 text-right">Returned</th>
                <th className="px-4 py-3 text-right">Net qty</th>
                <th className="px-4 py-3 text-right">Avg cost</th>
                <th className="px-4 py-3 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr
                  key={`${l.item_id}-${l.source}`}
                  className="border-b border-slate-50 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2.5">
                      <ItemThumb item={l} shape="square" size={32} />
                      <span className="min-w-0">
                        <p className="truncate font-semibold">{l.name}</p>
                        <p className="truncate text-xs text-slate-400 dark:text-slate-500">{l.sku}</p>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-col gap-0.5">
                      <span
                        className={`badge w-fit ${
                          l.source === "Stock"
                            ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                            : "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"
                        }`}
                      >
                        {l.source}
                      </span>
                      {l.vendor && (
                        <span className="truncate text-[11px] text-slate-400 dark:text-slate-500">{l.vendor}</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtQty(l.qty_signed_out, l.unit)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtQty(l.qty_returned, l.unit)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtQty(l.net_qty, l.unit)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(l.avg_snapshot_cost)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtMoney(l.net_cost)}</td>
                </tr>
              ))}
              <tr className="bg-emerald-50/60 dark:bg-emerald-500/10">
                <td colSpan={6} className="px-4 py-4">
                  <span className="inline-flex items-center gap-2 font-bold">
                    <Icon name="dollar-sign" size={16} className="text-emerald-600 dark:text-emerald-400" />
                    Material cost to recover
                  </span>
                </td>
                <td className="px-4 py-4 text-right">
                  <span className="stat-number text-[22px] text-emerald-600 dark:text-emerald-400">
                    {fmtMoney(total_cost)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      {tab === "activity" && (
        activity.length === 0 ? (
          <div className="card p-0">
            <Empty
              icon="history"
              title="No activity yet"
              hint="Sign-outs and returns for this job will show up here."
            />
          </div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">By</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                  >
                    <td className="whitespace-nowrap px-4 py-3">{fmtWhen(a.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <ItemThumb item={a} shape="square" size={32} />
                        <span className="min-w-0">
                          <p className="truncate font-semibold">{a.item_name}</p>
                          <p className="truncate text-xs text-slate-400 dark:text-slate-500">{a.sku}</p>
                        </span>
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${
                        a.type === "RETURN"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name={a.type === "RETURN" ? "refresh" : "arrow-right"} size={13} />
                        {fmtQty(a.qty, a.unit)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-col gap-0.5">
                        <span
                          className={`badge w-fit ${
                            a.source === "Stock"
                              ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                              : "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"
                          }`}
                        >
                          {a.source}
                        </span>
                        {a.vendor && (
                          <span className="truncate text-[11px] text-slate-400 dark:text-slate-500">{a.vendor}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">{a.user_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === "costing" && (
        costing === null ? (
          <div className="card p-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                className="btn-secondary"
                onClick={() =>
                  downloadCsv(`/jobs/${job.id}/costing?format=csv`, `${job.job_number}-costing.csv`)
                }
              >
                <Icon name="download" size={18} />
                CSV
              </button>
            </div>

            {costing.missing_rate_users.length > 0 && (
              <div className="alert-card">
                <span className="icon-disc bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400">
                  <Icon name="alert-triangle" size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-red-700 dark:text-red-300">
                    Labor cost may be understated
                  </span>
                  <span className="block text-[13px] text-red-600/80 dark:text-red-300/70">
                    No pay rate set for{" "}
                    {costing.missing_rate_users
                      .map((m) => `${m.user_name} (${m.hours}h)`)
                      .join(", ")}
                    . Set a rate in Settings → Techs to include their hours.
                  </span>
                </span>
              </div>
            )}

            <div className="card overflow-hidden p-0">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[14px] font-semibold text-slate-500 dark:text-slate-400">Revenue</span>
                  <span className="font-semibold tabular-nums">{fmtMoney(costing.revenue)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[14px] font-semibold text-slate-500 dark:text-slate-400">
                    Material cost
                  </span>
                  <span className="tabular-nums">−{fmtMoney(costing.material_cost)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[14px] font-semibold text-slate-500 dark:text-slate-400">
                    Labor cost
                    <span className="ml-1.5 font-normal text-slate-400 dark:text-slate-500">
                      ({costing.labor_hours}h)
                    </span>
                  </span>
                  <span className="tabular-nums">−{fmtMoney(costing.labor_cost)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[14px] font-semibold text-slate-500 dark:text-slate-400">Expenses</span>
                  <span className="tabular-nums">−{fmtMoney(costing.expense_cost)}</span>
                </div>
                <div
                  className={`flex items-center justify-between px-4 py-4 ${
                    parseFloat(costing.profit) >= 0
                      ? "bg-emerald-50/60 dark:bg-emerald-500/10"
                      : "bg-red-50/60 dark:bg-red-500/10"
                  }`}
                >
                  <span className="inline-flex items-center gap-2 font-bold">
                    <Icon
                      name="dollar-sign"
                      size={16}
                      className={
                        parseFloat(costing.profit) >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }
                    />
                    Profit
                  </span>
                  <span
                    className={`stat-number text-[22px] ${
                      parseFloat(costing.profit) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {fmtMoney(costing.profit)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <p className="section-title !mb-0">Revenue entries</p>
                <button className="btn-secondary !min-h-[38px] px-3 text-[13px]" onClick={() => setAddRevenueOpen(true)}>
                  <Icon name="plus" size={15} />
                  Add revenue
                </button>
              </div>
              {costing.revenue_lines.length === 0 ? (
                <div className="card p-0">
                  <Empty icon="dollar-sign" title="No revenue recorded yet" hint="Add a deposit or payment received for this job." />
                </div>
              ) : (
                <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
                  {costing.revenue_lines.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold">
                          {REVENUE_KIND_LABEL[r.kind] ?? r.kind}
                        </span>
                        <span className="block text-[12px] text-slate-400 dark:text-slate-500">
                          {r.received_date}
                          {r.ref ? ` · ${r.ref}` : ""}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">{fmtMoney(r.amount)}</span>
                      <button
                        className="icon-btn"
                        aria-label="Delete revenue entry"
                        onClick={async () => {
                          if (!confirm(`Delete this ${fmtMoney(r.amount)} revenue entry?`)) return;
                          await api(`/jobs/revenues/${r.id}`, { method: "DELETE" });
                          loadCosting();
                        }}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <p className="section-title !mb-0">Expenses (this job)</p>
                <button className="btn-secondary !min-h-[38px] px-3 text-[13px]" onClick={() => setAddExpenseOpen(true)}>
                  <Icon name="plus" size={15} />
                  Add expense
                </button>
              </div>
              {costing.expense_lines.length === 0 ? (
                <div className="card p-0">
                  <Empty icon="dollar-sign" title="No expenses logged for this job" hint="Fuel, permits, subcontractors, and more." />
                </div>
              ) : (
                <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
                  {costing.expense_lines.map((e) => (
                    <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold">{EXPENSE_CATEGORY_LABELS[e.category]}</span>
                        <span className="block truncate text-[12px] text-slate-400 dark:text-slate-500">
                          {e.expense_date}
                          {e.notes ? ` · ${e.notes}` : ""}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">{fmtMoney(e.amount)}</span>
                      <button className="icon-btn" aria-label="Edit expense" onClick={() => setEditingExpense(e)}>
                        <Icon name="pencil" size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Delete expense"
                        onClick={async () => {
                          if (!confirm(`Delete this ${fmtMoney(e.amount)} expense?`)) return;
                          await api(`/expenses/${e.id}`, { method: "DELETE" });
                          loadCosting();
                        }}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      )}

      {tab === "estimates" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setWizardOpen(true)}>
              <Icon name="plus" size={18} />
              New estimate for this job
            </button>
          </div>
          {estimates === null ? (
            <div className="card p-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
          ) : estimates.length === 0 ? (
            <div className="card p-0">
              <Empty
                icon="clipboard-list"
                title="No estimates yet"
                hint="Estimates you write up for this job will show up here."
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
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
        </div>
      )}

      {tab === "files" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              className="hidden"
              onChange={(e) => handleFilesPicked(e.target.files)}
            />
            <button
              className="btn-primary"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <Spinner /> : <Icon name="upload" size={18} />}
              Upload photos or documents
            </button>
          </div>

          {files === null ? (
            <div className="card p-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
          ) : files.length === 0 ? (
            <div className="card p-0">
              <Empty
                icon="image"
                title="No photos or documents yet"
                hint="Upload job-site photos, contracts, permits, or anything else worth keeping with this job."
              />
            </div>
          ) : (
            <>
              {files.some((f) => f.kind === "photo") && (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                  {files
                    .filter((f) => f.kind === "photo")
                    .map((f) => (
                      <LazyPhoto key={f.id} file={f} onRemove={() => removeFile(f.id)} />
                    ))}
                </div>
              )}

              {files.some((f) => f.kind === "document") && (
                <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
                  {files.filter((f) => f.kind === "document").map((f) => (
                    <div key={f.id} className="flex items-center gap-3 p-3.5">
                      <span className="icon-disc bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <Icon name="file-text" size={20} />
                      </span>
                      <button
                        onClick={() => downloadFile(f)}
                        disabled={downloadingId === f.id}
                        className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold hover:underline disabled:opacity-60"
                      >
                        {f.filename}
                        <span className="ml-2 font-normal text-slate-400 dark:text-slate-500">
                          {downloadingId === f.id ? "Loading…" : fmtBytes(f.size_bytes)}
                        </span>
                      </button>
                      <button className="icon-btn" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.filename}`}>
                        <Icon name="x" size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {wizardOpen && (
        <EstimateWizard
          jobId={job.id}
          initialCustomer={job.customer ?? job.name}
          initialAddress={job.address ?? ""}
          onClose={() => setWizardOpen(false)}
          onCreated={(e) => navigate(`/admin/estimates/${e.id}`)}
        />
      )}

      {addRevenueOpen && (
        <AddRevenueSheet jobId={job.id} onClose={() => setAddRevenueOpen(false)} onSaved={loadCosting} />
      )}

      {(addExpenseOpen || editingExpense) && (
        <ExpenseSheet
          expense={editingExpense ?? undefined}
          fixedJobId={job.id}
          onClose={() => {
            setAddExpenseOpen(false);
            setEditingExpense(null);
          }}
          onSaved={loadCosting}
        />
      )}
    </div>
  );
}
