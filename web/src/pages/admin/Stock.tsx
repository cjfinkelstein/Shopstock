import { useEffect, useState } from "react";

import { api, fmtMoney, fmtQty } from "../../api";
import { catTint } from "../../catcolor";
import Icon from "../../components/Icon";
import { Empty, ItemThumb, ListSkeleton } from "../../components/ui";
import type { Item, StockRow } from "../../types";

const LOCATION_ICON = (name: string) => (name === "Shop" ? "store" : "truck");

export default function Stock() {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [costByItem, setCostByItem] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    api<StockRow[]>("/stock").then(setRows).catch(() => {});
    api<Item[]>("/items?include_inactive=true").then((items) => {
      setCostByItem(new Map(items.map((i) => [i.id, parseFloat(i.avg_cost ?? "0")])));
    }).catch(() => {});
  }, []);

  if (!rows) return <ListSkeleton rows={5} />;

  const valueOf = (r: StockRow) => parseFloat(r.qty) * (costByItem.get(r.item_id) ?? 0);
  const grandTotal = rows.reduce((sum, r) => sum + valueOf(r), 0);

  const byLocation = new Map<string, StockRow[]>();
  for (const r of rows) {
    const list = byLocation.get(r.location_name) ?? [];
    list.push(r);
    byLocation.set(r.location_name, list);
  }
  // Shop first, then trucks alphabetically
  const locations = [...byLocation.keys()].sort((a, b) =>
    a === "Shop" ? -1 : b === "Shop" ? 1 : a.localeCompare(b),
  );

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-eyebrow">On hand right now</p>
          <h1 className="page-title">Stock</h1>
        </div>
        <div className="text-right">
          <p className="page-eyebrow">Total value</p>
          <p className="stat-number text-[24px] text-emerald-600 dark:text-emerald-400">
            {fmtMoney(grandTotal)}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty icon="package" title="Nothing in stock" hint="Receive material to see it here." />
      ) : (
        locations.map((loc) => {
          const items = byLocation.get(loc)!.sort((a, b) => a.name.localeCompare(b.name));
          const locTotal = items.reduce((sum, r) => sum + valueOf(r), 0);
          return (
            <section key={loc} className="space-y-2.5">
              <h2 className="section-title justify-between">
                <span className="flex items-center gap-2">
                  <Icon name={LOCATION_ICON(loc)} size={14} />
                  {loc}
                  <span className="font-normal normal-case tracking-normal text-slate-400">
                    · {items.length} item{items.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400">
                  {fmtMoney(locTotal)}
                </span>
              </h2>
              <div className="card overflow-x-auto p-0">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr
                        key={`${r.item_id}-${r.location_id}`}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2.5">
                            <ItemThumb item={r} shape="square" size={32} />
                            <span className="min-w-0">
                              <p className="truncate font-semibold">{r.name}</p>
                              <p className="truncate text-xs text-slate-400 dark:text-slate-500">{r.sku}</p>
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge ${catTint(r.category).badge}`}>{r.category}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {fmtQty(r.qty, r.unit)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {fmtMoney(valueOf(r))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
