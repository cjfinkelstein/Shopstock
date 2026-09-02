import { useEffect, useState } from "react";

import { api, fmtMoney } from "../../api";
import Icon from "../../components/Icon";
import { Empty, ItemThumb, Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import type { Item, Vendor } from "../../types";

interface Line {
  item: Item;
  qty: string;
  unit_cost: string;
}

export default function Receive() {
  const toast = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<number | "">("");
  const [ref, setRef] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Vendor[]>("/vendors").then(setVendors).catch(() => {});
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api<Item[]>(`/items?search=${encodeURIComponent(search)}`)
        .then((r) => setResults(r.slice(0, 6)))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const addItem = (item: Item) => {
    setSearch("");
    setResults([]);
    setLines((ls) =>
      ls.some((l) => l.item.id === item.id)
        ? ls
        : [...ls, { item, qty: "", unit_cost: item.last_cost ?? "" }],
    );
  };

  const update = (id: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.item.id === id ? { ...l, ...patch } : l)));

  const valid =
    vendorId !== "" &&
    lines.length > 0 &&
    lines.every((l) => parseFloat(l.qty) > 0 && parseFloat(l.unit_cost) >= 0);

  const total = lines.reduce(
    (sum, l) => sum + (parseFloat(l.qty) || 0) * (parseFloat(l.unit_cost) || 0),
    0,
  );

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api("/transactions/receive/batch", {
        method: "POST",
        body: {
          vendor_id: vendorId,
          ref: ref || null,
          lines: lines.map((l) => ({ item_id: l.item.id, qty: l.qty, unit_cost: l.unit_cost })),
        },
      });
      toast("success", `Received ${lines.length} line${lines.length === 1 ? "" : "s"} into shop stock`);
      setLines([]);
      setRef("");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Receive failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5 animate-fade-up">
      <div>
        <p className="page-eyebrow">Purchasing</p>
        <h1 className="page-title">Receive material</h1>
      </div>

      <div className="card">
        <p className="section-title">
          <Icon name="briefcase" size={14} />
          Order details
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Vendor *</span>
            <select
              className="input"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Select vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">PO / receipt #</span>
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Optional" />
          </label>
        </div>
      </div>

      <div className="relative">
        <Icon
          name="search"
          size={20}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
        />
        <input
          className="input min-h-[52px] rounded-2xl pl-12 text-[16px]"
          aria-label="Search the catalog to add lines"
          placeholder="Search the catalog to add lines…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {results.length > 0 && (
          <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-2xl dark:border-slate-700/60 dark:bg-slate-900 animate-fade-in">
            {results.map((i) => {
              return (
                <button
                  key={i.id}
                  className="flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                  onClick={() => addItem(i)}
                >
                  <ItemThumb item={i} shape="square" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{i.name}</span>
                    <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">
                      {i.sku} · {i.unit}
                    </span>
                  </span>
                  <Icon name="plus" size={18} className="text-slate-300 dark:text-slate-600" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {lines.length > 0 ? (
        <div className="card space-y-3">
          <p className="section-title">
            <Icon name="layers" size={14} />
            Lines
            <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {lines.length}
            </span>
          </p>
          {lines.map((l) => {
            return (
              <div
                key={l.item.id}
                className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 pb-3 last:border-0 last:pb-0 dark:border-slate-800"
              >
                <ItemThumb item={l.item} shape="square" />
                <div className="min-w-[140px] flex-1">
                  <p className="truncate text-[15px] font-semibold">{l.item.name}</p>
                  <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                    <span className="font-mono">{l.item.sku}</span> · {l.item.unit}
                  </p>
                </div>
                <input
                  className="input max-w-[110px] text-center tabular-nums"
                  type="number"
                  inputMode="decimal"
                  aria-label={`Quantity for ${l.item.name}`}
                  placeholder="Qty"
                  value={l.qty}
                  onChange={(e) => update(l.item.id, { qty: e.target.value })}
                />
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                    $
                  </span>
                  <input
                    className="input max-w-[130px] pl-8 tabular-nums"
                    type="number"
                    step="0.0001"
                    inputMode="decimal"
                    aria-label={`Unit cost for ${l.item.name}`}
                    placeholder="Unit cost"
                    value={l.unit_cost}
                    onChange={(e) => update(l.item.id, { unit_cost: e.target.value })}
                  />
                </div>
                <button
                  className="icon-btn hover:text-red-500 dark:hover:text-red-400"
                  onClick={() => setLines((ls) => ls.filter((x) => x.item.id !== l.item.id))}
                  aria-label={`Remove ${l.item.name}`}
                >
                  <Icon name="trash" size={19} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon="search" title="No lines yet" hint="Search to add lines" />
      )}

      {lines.length > 0 && (
        <div className="card flex items-center gap-3">
          <span className="icon-disc bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <Icon name="dollar-sign" size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Running total
            </span>
            <span className="block text-[13px] text-slate-400 dark:text-slate-500">
              {lines.length} line{lines.length === 1 ? "" : "s"} · {fmtMoney(total)} total
            </span>
          </span>
          <span className="stat-number text-[30px]">{fmtMoney(total)}</span>
        </div>
      )}

      <button className="btn-primary min-h-[58px] w-full text-lg" disabled={!valid || busy} onClick={submit}>
        {busy ? <Spinner /> : null}
        {busy ? "Receiving…" : `Receive ${lines.length || ""} line${lines.length === 1 ? "" : "s"} into Shop`}
        {!busy && <Icon name="arrow-right" size={20} />}
      </button>
    </div>
  );
}
