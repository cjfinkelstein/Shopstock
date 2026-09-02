import { useState } from "react";

import Icon from "./Icon";

interface Props {
  unit: "each" | "box" | "foot";
  initial?: string;
  onConfirm: (qty: string) => void;
  confirmLabel?: string;
  /** Foot chips confirm immediately when nothing is typed yet — keeps common
   * wire pulls at one tap. */
  quickAdvance?: boolean;
}

const FOOT_CHIPS = [25, 50, 100, 250];

const KEY_CLASS =
  "flex min-h-[60px] select-none items-center justify-center rounded-2xl border border-slate-200 bg-white text-2xl font-semibold text-slate-800 shadow-card transition-transform duration-100 active:scale-95 dark:border-slate-700/60 dark:bg-slate-800 dark:text-slate-100";

/** Big-thumb quantity entry. Whole numbers for each/box; foot items get
 * +25/+50/+100/+250 ft quick chips plus manual decimal entry. */
export default function QtyPad({
  unit,
  initial = "",
  onConfirm,
  confirmLabel = "Next",
  quickAdvance = false,
}: Props) {
  const [value, setValue] = useState(initial);
  const isFoot = unit === "foot";

  const valid = (() => {
    const n = parseFloat(value);
    if (!value || isNaN(n) || n <= 0) return false;
    if (!isFoot && !Number.isInteger(n)) return false;
    if (isFoot && !/^\d+(\.\d{1,2})?$/.test(value)) return false;
    return true;
  })();

  const press = (key: string) => {
    if (key === "⌫") {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key === ".") {
      if (!isFoot || value.includes(".")) return;
      setValue((v) => (v === "" ? "0." : v + "."));
      return;
    }
    setValue((v) => {
      if (v === "0") return key;
      const next = v + key;
      if (isFoot && !/^\d*(\.\d{0,2})?$/.test(next)) return v;
      if (next.replace(".", "").length > 7) return v;
      return next;
    });
  };

  const addChip = (n: number) => {
    if (quickAdvance && !value) {
      onConfirm(String(n));
      return;
    }
    setValue((v) => {
      const cur = parseFloat(v) || 0;
      const sum = cur + n;
      return Number.isInteger(sum) ? String(sum) : sum.toFixed(2);
    });
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", isFoot ? "." : "", "0", "⌫"];

  return (
    <div className="space-y-4">
      <div className="flex min-h-[88px] items-end justify-center gap-1.5 rounded-2xl bg-slate-100 px-4 pb-4 pt-3 dark:bg-slate-800/80">
        <span className="text-5xl font-bold leading-none tracking-tight tabular-nums text-slate-900 dark:text-slate-50">
          {value || <span className="text-slate-300 dark:text-slate-600">0</span>}
        </span>
        {isFoot && value && (
          <span className="pb-0.5 text-lg font-medium text-slate-400 dark:text-slate-500">ft</span>
        )}
      </div>

      {isFoot && (
        <div className="grid grid-cols-4 gap-2">
          {FOOT_CHIPS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => addChip(n)}
              className="chip min-h-[48px] justify-center px-2 font-semibold"
            >
              <Icon name="plus" size={14} strokeWidth={2.5} />
              {n} ft
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {keys.map((k, i) =>
          k === "" ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => press(k)}
              className={KEY_CLASS}
              aria-label={k === "⌫" ? "Delete" : k}
            >
              {k === "⌫" ? <Icon name="backspace" size={24} /> : k}
            </button>
          ),
        )}
      </div>

      <button type="button" disabled={!valid} onClick={() => onConfirm(value)} className="btn-primary w-full text-lg">
        {confirmLabel}
      </button>
    </div>
  );
}
