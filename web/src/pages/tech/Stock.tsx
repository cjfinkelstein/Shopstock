import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, fmtQty } from "../../api";
import Icon from "../../components/Icon";
import { Empty, ItemThumb, ListSkeleton } from "../../components/ui";
import type { StockRow } from "../../types";

export default function Stock() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<StockRow[] | null>(null);

  useEffect(() => {
    api<StockRow[]>("/stock").then(setRows).catch(() => {});
  }, []);

  if (rows === null) return <ListSkeleton rows={5} />;

  const byLocation = new Map<string, StockRow[]>();
  for (const r of rows) {
    const list = byLocation.get(r.location_name) ?? [];
    list.push(r);
    byLocation.set(r.location_name, list);
  }
  // Shop first, then trucks alphabetically -- the shop is the main
  // inventory location, trucks are everything loaded out of it.
  const names = [...byLocation.keys()].sort((a, b) => {
    if (a === "Shop") return -1;
    if (b === "Shop") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-5 animate-fade-up">
      <header>
        <p className="page-eyebrow">Shop &amp; fleet</p>
        <h1 className="page-title mt-1">Stock</h1>
      </header>

      {names.length === 0 ? (
        <Empty icon="package" title="Nothing in stock" hint="Nothing is on hand at the shop or on a truck right now." />
      ) : (
        names.map((name) => {
          const items = byLocation.get(name)!.sort((a, b) => a.name.localeCompare(b.name));
          return (
            <section key={name} className="space-y-2.5">
              <h2 className="section-title">
                <Icon name={name === "Shop" ? "package" : "truck"} size={14} />
                {name}
                <span className="ml-auto tabular-nums">{items.length}</span>
              </h2>
              <div className="space-y-2.5">
                {items.map((r) => (
                  <button
                    key={r.item_id}
                    onClick={() => navigate(`/item/${r.item_id}`)}
                    className="card-interactive flex w-full items-center gap-3 p-3.5"
                  >
                    <ItemThumb item={r} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{r.name}</span>
                      <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">
                        {r.sku}
                      </span>
                    </span>
                    <span className="text-[17px] font-bold tabular-nums">{fmtQty(r.qty, r.unit)}</span>
                    <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
                  </button>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
