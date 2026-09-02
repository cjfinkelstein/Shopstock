import { useEffect, useState } from "react";

import { api } from "../api";
import { useToast } from "../toast";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "../types";
import type { Expense, ExpenseCategory, Job } from "../types";
import Icon from "./Icon";
import Sheet from "./Sheet";
import { Spinner } from "./ui";

const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const todayIso = () => new Date().toISOString().slice(0, 10);

interface Props {
  /** Editing an existing expense, or undefined to create a new one. */
  expense?: Expense;
  /** Pins the expense to one job and hides the job selector — used from a job's Cost & Profit tab. */
  fixedJobId?: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function ExpenseSheet({ expense, fixedJobId, onClose, onSaved }: Props) {
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [date, setDate] = useState(expense?.expense_date ?? todayIso());
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? "misc");
  const [jobId, setJobId] = useState<string>(
    fixedJobId != null ? String(fixedJobId) : expense?.job_id != null ? String(expense.job_id) : "",
  );
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [receiptData, setReceiptData] = useState<string | null | undefined>(undefined); // undefined = unchanged
  const [receiptFilename, setReceiptFilename] = useState<string | null>(expense?.receipt_filename ?? null);
  const [receiptMime, setReceiptMime] = useState<string | null>(expense?.receipt_mime_type ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (fixedJobId != null) return;
    api<Job[]>("/jobs?status=&search=").then(setJobs).catch(() => {});
  }, [fixedJobId]);

  const pickReceipt = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_RECEIPT_BYTES) {
      toast("error", "Photo is too big (max 15MB)");
      return;
    }
    setReceiptData(await readAsDataUrl(file));
    setReceiptFilename(file.name);
    setReceiptMime(file.type || "image/jpeg");
  };

  const save = async () => {
    if (!date || !amount) {
      toast("error", "Date and amount are required");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        expense_date: date,
        amount,
        category,
        job_id: jobId ? Number(jobId) : null,
        notes: notes.trim() || null,
      };
      if (!jobId && expense) body.clear_job = true;
      if (receiptData !== undefined) {
        body.receipt_data = receiptData;
        body.receipt_filename = receiptFilename;
        body.receipt_mime_type = receiptMime;
        if (receiptData === null) body.clear_receipt = true;
      }
      if (expense) {
        await api(`/expenses/${expense.id}`, { method: "PATCH", body });
        toast("success", "Expense saved");
      } else {
        await api("/expenses", { method: "POST", body });
        toast("success", "Expense added");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={expense ? "Edit expense" : "Add expense"} onClose={onClose}>
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
          <span className="label">Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        {fixedJobId == null && (
          <label className="block">
            <span className="label">Job (optional)</span>
            <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Overhead (no job)</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_number} — {j.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="label">Notes</span>
          <textarea
            className="input min-h-[72px] resize-none"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was this for?"
          />
        </label>

        <label className="block">
          <span className="label">Receipt photo (optional)</span>
          {receiptFilename ? (
            <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200/70 p-2.5 dark:border-slate-800">
              <span className="icon-disc bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <Icon name="file-text" size={18} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{receiptFilename}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove receipt"
                onClick={() => {
                  setReceiptData(null);
                  setReceiptFilename(null);
                }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          ) : (
            <label className="card-interactive flex w-full cursor-pointer items-center gap-3 border-dashed p-3.5">
              <span className="icon-tile bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <Icon name="upload" size={18} />
              </span>
              <span className="text-[14px] font-semibold">Attach a photo</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickReceipt(e.target.files?.[0])}
              />
            </label>
          )}
        </label>

        <button className="btn-primary w-full" disabled={busy} onClick={save}>
          {busy ? <Spinner /> : <Icon name="check" size={18} />}
          {expense ? "Save changes" : "Add expense"}
        </button>
      </div>
    </Sheet>
  );
}
