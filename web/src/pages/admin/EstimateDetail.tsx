import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api, downloadCsv, fmtMoney } from "../../api";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { ItemThumb, PageLoader, Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import type { Estimate, EstimateLine, EstimateSection, Item } from "../../types";

type EditableLine = {
  key: number; // client-side identity, stable across re-renders even before save
  item_id: number | null;
  sku?: string | null;
  image_data?: string | null;
  description: string;
  qty: string;
  unit: string;
  material_unit_cost: string;
  labor_unit_cost: string;
};

type EditableSection = {
  key: number;
  name: string;
  lines: EditableLine[];
};

const STATUS_OPTIONS = ["draft", "sent", "approved", "declined"] as const;

let nextKey = -1; // negative keys = not-yet-saved rows, never collide with real DB ids

function toEditableLine(l: EstimateLine): EditableLine {
  return {
    key: l.id, item_id: l.item_id, sku: l.sku, image_data: l.image_data,
    description: l.description, qty: l.qty, unit: l.unit,
    material_unit_cost: l.material_unit_cost, labor_unit_cost: l.labor_unit_cost,
  };
}

function toEditableSections(sections: EstimateSection[]): EditableSection[] {
  return sections.map((s) => ({ key: s.id, name: s.name, lines: s.lines.map(toEditableLine) }));
}

export default function EstimateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [customer, setCustomer] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [scope, setScope] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [profitPct, setProfitPct] = useState("0");
  const [discountPct, setDiscountPct] = useState("0");
  const [sections, setSections] = useState<EditableSection[]>([]);
  const [saving, setSaving] = useState(false);
  const [redrafting, setRedrafting] = useState(false);
  const [picking, setPicking] = useState<number | null>(null); // section key being added to
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Item[]>([]);

  const load = useCallback(() => {
    api<Estimate>(`/estimates/${id}`)
      .then((e) => {
        setEstimate(e);
        setCustomer(e.customer ?? "");
        setAddress(e.address ?? "");
        setStatus(e.status);
        setScope(e.scope_of_work);
        setExclusions(e.exclusions ?? "");
        setProfitPct(e.profit_pct);
        setDiscountPct(e.discount_pct);
        setSections(toEditableSections(e.sections));
      })
      .catch(() => navigate("/admin/estimates"));
  }, [id, navigate]);

  useEffect(load, [load]);

  useEffect(() => {
    if (picking === null) return;
    const t = setTimeout(() => {
      api<Item[]>(`/items?search=${encodeURIComponent(search)}`).then((r) => setResults(r.slice(0, 20))).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [picking, search]);

  const totals = useMemo(() => {
    let material = 0;
    let labor = 0;
    const sectionTotals = sections.map((s) => {
      let sTotal = 0;
      for (const l of s.lines) {
        const qty = parseFloat(l.qty) || 0;
        const m = qty * (parseFloat(l.material_unit_cost) || 0);
        const lb = qty * (parseFloat(l.labor_unit_cost) || 0);
        material += m;
        labor += lb;
        sTotal += m + lb;
      }
      return sTotal;
    });
    const subtotal = material + labor;
    const profitAmount = subtotal * (parseFloat(profitPct) || 0) / 100;
    const discountAmount = (subtotal + profitAmount) * (parseFloat(discountPct) || 0) / 100;
    const total = subtotal + profitAmount - discountAmount;
    return { material, labor, subtotal, profitAmount, discountAmount, total, sectionTotals };
  }, [sections, profitPct, discountPct]);

  const updateLine = (sectionKey: number, lineKey: number, patch: Partial<EditableLine>) => {
    setSections((secs) =>
      secs.map((s) =>
        s.key !== sectionKey ? s : { ...s, lines: s.lines.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)) },
      ),
    );
  };

  const removeLine = (sectionKey: number, lineKey: number) => {
    setSections((secs) =>
      secs.map((s) => (s.key !== sectionKey ? s : { ...s, lines: s.lines.filter((l) => l.key !== lineKey) })),
    );
  };

  const addItemLine = (sectionKey: number, item: Item) => {
    setSections((secs) =>
      secs.map((s) =>
        s.key !== sectionKey
          ? s
          : {
              ...s,
              lines: [
                ...s.lines,
                {
                  key: nextKey--, item_id: item.id, sku: item.sku, image_data: item.image_data,
                  description: item.name, qty: "1", unit: item.unit,
                  material_unit_cost: item.avg_cost ?? "0", labor_unit_cost: "0",
                },
              ],
            },
      ),
    );
    setPicking(null);
    setSearch("");
  };

  const addCustomLine = (sectionKey: number) => {
    setSections((secs) =>
      secs.map((s) =>
        s.key !== sectionKey
          ? s
          : {
              ...s,
              lines: [
                ...s.lines,
                { key: nextKey--, item_id: null, description: "", qty: "1", unit: "each", material_unit_cost: "0", labor_unit_cost: "0" },
              ],
            },
      ),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/estimates/${id}`, {
        method: "PATCH",
        body: {
          customer, address, scope_of_work: scope, exclusions, status,
          profit_pct: profitPct, discount_pct: discountPct,
          sections: sections.map((s) => ({
            name: s.name,
            lines: s.lines.map((l) => ({
              item_id: l.item_id, description: l.description, qty: l.qty, unit: l.unit,
              material_unit_cost: l.material_unit_cost, labor_unit_cost: l.labor_unit_cost,
            })),
          })),
        },
      });
      toast("success", "Estimate saved");
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const redraft = async () => {
    setRedrafting(true);
    try {
      // Save the current scope text first so the redraft matches what's on screen.
      await api(`/estimates/${id}`, { method: "PATCH", body: { scope_of_work: scope } });
      const e = await api<Estimate>(`/estimates/${id}/redraft`, { method: "POST" });
      setSections(toEditableSections(e.sections));
      toast("success", "Materials list regenerated from the scope of work");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Could not regenerate");
    } finally {
      setRedrafting(false);
    }
  };

  const remove = async () => {
    if (!estimate) return;
    if (!confirm(`Delete ${estimate.estimate_number}? This can't be undone.`)) return;
    await api(`/estimates/${id}`, { method: "DELETE" });
    toast("success", "Estimate deleted");
    navigate("/admin/estimates");
  };

  if (!estimate) return <PageLoader />;

  return (
    <div className="max-w-4xl space-y-5 animate-fade-up">
      <button onClick={() => navigate("/admin/estimates")} className="btn-ghost -ml-3 px-3">
        <Icon name="arrow-left" size={18} />
        Estimates
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="page-eyebrow font-mono">{estimate.estimate_number}</p>
          <h1 className="page-title">{customer || "No customer name"}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary"
            onClick={() => downloadCsv(`/estimates/${id}/export`, `${estimate.estimate_number}.xlsx`)}
          >
            <Icon name="download" size={18} />
            Export to Excel
          </button>
          <button className="btn-secondary" onClick={remove}>
            <Icon name="trash" size={18} />
            Delete
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Customer</span>
          <input className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Address</span>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
      </div>

      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="section-title !mb-0">
            <Icon name="clipboard-list" size={14} />
            Scope of work
          </span>
          <button className="btn-secondary !min-h-[36px] px-3 text-[13px]" disabled={redrafting} onClick={redraft}>
            {redrafting ? <Spinner /> : <Icon name="refresh" size={15} />}
            Regenerate materials
          </button>
        </div>
        <textarea
          className="input min-h-[120px] py-3"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
        <p className="text-[12px] text-slate-400 dark:text-slate-500">
          Lines mentioning "demo" go to Demolition, "rough-in" go to Rough-In, "panel/meter/breaker/
          disconnect/transformer" go to Panels & Meters, "permit/inspection" go to Permits,
          "customer-supplied" goes to that section, "relocate/clean up" go to Miscellaneous — everything
          else defaults to Supply and Install.
        </p>
      </div>

      {sections.map((section) => (
        <div key={section.key} className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="section-title !mb-0">
              <Icon name="package" size={14} />
              {section.name}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-semibold text-slate-400 dark:text-slate-500">
                {fmtMoney(totals.sectionTotals[sections.indexOf(section)]?.toFixed(2) ?? "0")}
              </span>
              <div className="flex gap-2">
                <button className="btn-secondary !min-h-[32px] px-2.5 text-[12px]" onClick={() => setPicking(section.key)}>
                  <Icon name="plus" size={14} />
                  Item
                </button>
                <button className="btn-secondary !min-h-[32px] px-2.5 text-[12px]" onClick={() => addCustomLine(section.key)}>
                  <Icon name="plus" size={14} />
                  Custom
                </button>
              </div>
            </div>
          </div>

          {section.lines.length === 0 ? (
            <p className="py-3 text-center text-[13px] text-slate-400 dark:text-slate-500">Nothing in this section yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                    <th className="py-2 pr-3">Description</th>
                    <th className="py-2 pr-3 w-20 text-right">Qty</th>
                    <th className="py-2 pr-3 w-24 text-right">Material</th>
                    <th className="py-2 pr-3 w-24 text-right">Labor</th>
                    <th className="py-2 pr-3 w-28 text-right">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {section.lines.map((l) => {
                    const qty = parseFloat(l.qty) || 0;
                    const lineTotal = qty * ((parseFloat(l.material_unit_cost) || 0) + (parseFloat(l.labor_unit_cost) || 0));
                    return (
                      <tr key={l.key} className="border-b border-slate-50 last:border-0 dark:border-slate-800/60">
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-2">
                            {l.item_id ? <ItemThumb item={l} shape="square" size={28} /> : null}
                            <input
                              className="input !min-h-[38px] flex-1 py-1.5"
                              value={l.description}
                              onChange={(e) => updateLine(section.key, l.key, { description: e.target.value })}
                            />
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            className="input !min-h-[38px] text-right py-1.5"
                            type="number"
                            value={l.qty}
                            onChange={(e) => updateLine(section.key, l.key, { qty: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            className="input !min-h-[38px] text-right py-1.5"
                            type="number"
                            value={l.material_unit_cost}
                            onChange={(e) => updateLine(section.key, l.key, { material_unit_cost: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            className="input !min-h-[38px] text-right py-1.5"
                            type="number"
                            value={l.labor_unit_cost}
                            onChange={(e) => updateLine(section.key, l.key, { labor_unit_cost: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{fmtMoney(lineTotal.toFixed(2))}</td>
                        <td className="py-2">
                          <button className="icon-btn" onClick={() => removeLine(section.key, l.key)} aria-label="Remove line">
                            <Icon name="x" size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {picking === section.key && (
            <Sheet title="Add item" subtitle={`To ${section.name}`} onClose={() => setPicking(null)}>
              <div className="space-y-3">
                <div className="relative">
                  <Icon
                    name="search"
                    size={18}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  />
                  <input
                    className="input pl-10"
                    placeholder="Search name or SKU…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  {results.map((r) => (
                    <button
                      key={r.id}
                      className="card-interactive flex w-full items-center gap-3 p-3 text-left"
                      onClick={() => addItemLine(section.key, r)}
                    >
                      <ItemThumb item={r} shape="square" size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{r.name}</span>
                        <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">
                          {r.sku} · {fmtMoney(r.avg_cost ?? "0")}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </Sheet>
          )}
        </div>
      ))}

      <div className="card space-y-3 p-4">
        <span className="section-title !mb-0">
          <Icon name="x" size={14} />
          Exclusions
        </span>
        <textarea
          className="input min-h-[80px] py-3"
          placeholder="e.g. Low Voltage, Fire Alarms"
          value={exclusions}
          onChange={(e) => setExclusions(e.target.value)}
        />
      </div>

      <div className="card grid grid-cols-1 gap-3.5 p-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Profit %</span>
          <input className="input" type="number" value={profitPct} onChange={(e) => setProfitPct(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Repeat customer discount %</span>
          <input className="input" type="number" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
        </label>
      </div>

      <div className="card space-y-1.5 p-4">
        <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Material</span>
          <span className="tabular-nums">{fmtMoney(totals.material.toFixed(2))}</span>
        </div>
        <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Labor</span>
          <span className="tabular-nums">{fmtMoney(totals.labor.toFixed(2))}</span>
        </div>
        <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Total cost of material and labor</span>
          <span className="tabular-nums">{fmtMoney(totals.subtotal.toFixed(2))}</span>
        </div>
        <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Profit ({profitPct || 0}%)</span>
          <span className="tabular-nums">{fmtMoney(totals.profitAmount.toFixed(2))}</span>
        </div>
        {totals.discountAmount > 0 && (
          <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
            <span>Discount ({discountPct || 0}%)</span>
            <span className="tabular-nums">-{fmtMoney(totals.discountAmount.toFixed(2))}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-slate-100 pt-2 text-[18px] font-bold dark:border-slate-800">
          <span>Total cost of project</span>
          <span className="stat-number tabular-nums text-emerald-600 dark:text-emerald-400">
            {fmtMoney(totals.total.toFixed(2))}
          </span>
        </div>
      </div>

      <button className="btn-primary w-full" disabled={saving} onClick={save}>
        {saving ? <Spinner /> : <Icon name="check" size={18} />}
        Save changes
      </button>
    </div>
  );
}
