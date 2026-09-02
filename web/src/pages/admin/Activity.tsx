import { useEffect, useState } from "react";

import { api } from "../../api";
import Icon from "../../components/Icon";
import TxnList from "../../components/TxnList";
import { ListSkeleton, Spinner } from "../../components/ui";
import type { Txn, TxnPage } from "../../types";

/** New-York-calendar-day helpers — pure client-side grouping of fetched txns. */
const NY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const NY_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

/** Backend timestamps are naive-UTC — same normalization as fmtWhen. */
function toDate(iso: string): Date {
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
}

function dayLabel(d: Date): string {
  const key = NY_DAY.format(d);
  const now = Date.now();
  if (key === NY_DAY.format(new Date(now))) return "Today";
  if (key === NY_DAY.format(new Date(now - 86_400_000))) return "Yesterday";
  return NY_LABEL.format(d);
}

function groupByDay(txns: Txn[]): { key: string; label: string; txns: Txn[] }[] {
  const groups: { key: string; label: string; txns: Txn[] }[] = [];
  for (const t of txns) {
    const d = toDate(t.created_at);
    const key = NY_DAY.format(d);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.txns.push(t);
    else groups.push({ key, label: dayLabel(d), txns: [t] });
  }
  return groups;
}

export default function Activity() {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<TxnPage>(`/transactions?page=${page}&page_size=25`)
      .then((r) => {
        setTotal(r.total);
        setTxns((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <div className="space-y-4 animate-fade-up">
      <div>
        <p className="page-eyebrow">Everything moving</p>
        <h1 className="page-title">Activity</h1>
      </div>

      {loading && txns.length === 0 ? (
        <ListSkeleton rows={6} />
      ) : txns.length === 0 ? (
        <TxnList txns={txns} showUser />
      ) : (
        groupByDay(txns).map((g) => (
          <section key={g.key} className="space-y-2.5">
            <h2 className="section-title !mb-0">
              <Icon name="history" size={14} />
              {g.label}
            </h2>
            <TxnList txns={g.txns} showUser />
          </section>
        ))
      )}

      {txns.length < total && (
        <button
          className="btn-secondary w-full"
          disabled={loading}
          onClick={() => setPage((p) => p + 1)}
        >
          {loading ? <Spinner /> : null}
          Load more
        </button>
      )}
    </div>
  );
}
