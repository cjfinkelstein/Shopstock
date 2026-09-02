import { fmtQty, fmtWhen } from "../api";
import type { Txn } from "../types";

import Icon from "./Icon";
import { Empty } from "./ui";

/** Badge tint + a type-colored round icon-disc so rows read at a glance
 * (txn rows have no item category — the type is the identity). Disc colors
 * are soft pastels so the live-updates list feels friendly, not loud. */
const TYPE_META: Record<Txn["type"], { label: string; cls: string; icon: string; disc: string }> = {
  SIGN_OUT: {
    label: "Sign-out",
    cls: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
    icon: "arrow-right",
    disc: "bg-brand-100 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400",
  },
  RETURN: {
    label: "Return",
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    icon: "refresh",
    disc: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  TRANSFER: {
    label: "Transfer",
    cls: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    icon: "arrow-swap",
    disc: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  },
  RECEIVE: {
    label: "Receive",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    icon: "inbox",
    disc: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  },
  ADJUST: {
    label: "Adjust",
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    icon: "wrench",
    disc: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  },
};

export function txnWhereText(t: Txn): string {
  if (t.type === "SIGN_OUT") return `${t.from_location_name} → ${t.job_number}`;
  if (t.type === "RETURN") return `${t.job_number} → ${t.to_location_name}`;
  if (t.type === "TRANSFER") return `${t.from_location_name} → ${t.to_location_name}`;
  if (t.type === "RECEIVE") return `→ ${t.to_location_name}`;
  return t.from_location_id ? `− ${t.from_location_name}` : `+ ${t.to_location_name}`;
}

export default function TxnList({ txns, showUser = false }: { txns: Txn[]; showUser?: boolean }) {
  if (txns.length === 0) return <Empty icon="history" title="No activity yet" />;
  return (
    <ul className="space-y-2.5">
      {txns.map((t) => {
        const meta = TYPE_META[t.type];
        return (
          <li key={t.id} className="card flex items-center gap-3 p-3.5">
            {t.item_image ? (
              <img
                src={t.item_image}
                alt=""
                className="h-11 w-11 shrink-0 rounded-full border border-slate-200/70 object-cover dark:border-slate-700"
              />
            ) : (
              <span className={`icon-disc ${meta.disc}`}>
                <Icon name={meta.icon} size={20} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px]">
                <span className="font-bold tabular-nums">{fmtQty(t.qty, t.item_unit ?? undefined)}</span>{" "}
                <span className="font-semibold">{t.item_name}</span>
              </div>
              <div className="truncate text-[13px] text-slate-400 dark:text-slate-500">
                {txnWhereText(t)}
                {showUser && t.user_name ? ` · ${t.user_name}` : ""}
                {" · "}
                {fmtWhen(t.created_at)}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`badge ${meta.cls}`}>{meta.label}</span>
              {t.went_negative && (
                <span className="flex items-center gap-1 text-[12px] font-bold text-amber-600 dark:text-amber-500">
                  <Icon name="alert-triangle" size={15} />
                  negative
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
