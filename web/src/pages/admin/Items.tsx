import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api, apiBlob, fmtMoney } from "../../api";
import { catTint } from "../../catcolor";
import Icon from "../../components/Icon";
import { Empty, ListSkeleton, Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import type { Item, Vendor } from "../../types";

const EMPTY_FORM = {
  sku: "", barcode: "", name: "", description: "", image_data: "", category: "", unit: "each",
  reorder_point: "0", reorder_qty: "0", notes: "",
};

const THUMB_MAX = 160;

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric",
  });
}

function fileToThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Not a valid image"));
      img.onload = () => {
        const scale = Math.min(1, THUMB_MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function Items() {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [vendorId, setVendorId] = useState<number | "">("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [datesExpanded, setDatesExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [showInactive, setShowInactive] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Item[]>(
      `/items?search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}${vendorId ? `&vendor_id=${vendorId}` : ""}${showInactive ? "&include_inactive=true" : ""}`,
    )
      .then((r) => {
        setItems(r);
        setLoaded(true);
      })
      .catch(() => {});
    api<string[]>("/items/categories").then(setCategories).catch(() => {});
  }, [search, category, vendorId, showInactive]);

  useEffect(() => {
    api<Vendor[]>("/vendors").then(setVendors).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const printLabels = async () => {
    try {
      const blob = await apiBlob("/labels/print", {
        method: "POST",
        body: { item_ids: Array.from(selected) },
      });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch {
      toast("error", "Could not build the label sheet");
    }
  };

  const openEdit = (item: Item | "new") => {
    setEditing(item);
    if (item === "new") setForm(EMPTY_FORM);
    else
      setForm({
        sku: item.sku, barcode: item.barcode, name: item.name,
        description: item.description ?? "", image_data: item.image_data ?? "",
        category: item.category, unit: item.unit,
        reorder_point: item.reorder_point ?? "0", reorder_qty: item.reorder_qty ?? "0",
        notes: item.notes ?? "",
      });
  };

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const thumb = await fileToThumbnail(file);
      setForm((f) => ({ ...f, image_data: thumb }));
    } catch {
      toast("error", "Could not use that image");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, barcode: form.barcode || form.sku };
      if (editing === "new") {
        await api("/items", { method: "POST", body });
        toast("success", "Item created");
      } else if (editing) {
        await api(`/items/${editing.id}`, { method: "PATCH", body });
        toast("success", "Item saved");
      }
      setEditing(null);
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (item: Item, active: boolean) => {
    await api(`/items/${item.id}`, { method: "PATCH", body: { active } });
    load();
  };

  // plain function (not a JSX component) so inputs keep focus across re-renders
  const F = (label: string, field: string, type = "text") => (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="input"
        type={type}
        value={form[field] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
      />
    </label>
  );

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-eyebrow">
            Catalog{loaded ? ` · ${items.length} item${items.length === 1 ? "" : "s"}` : ""}
          </p>
          <h1 className="page-title">Items</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <button className="btn-secondary" onClick={printLabels}>
              <Icon name="printer" size={18} />
              Shelf labels ({selected.size})
            </button>
          )}
          <button className="btn-primary" onClick={() => openEdit("new")}>
            <Icon name="plus" size={18} />
            New item
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
          <input
            className="input pl-10"
            aria-label="Search items"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input max-w-[180px]"
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button
          type="button"
          className={`chip ${showInactive ? "chip-active" : ""}`}
          aria-pressed={showInactive}
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive && <Icon name="check" size={15} />}
          Show inactive
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`chip ${vendorId === "" ? "chip-active" : ""}`}
          aria-pressed={vendorId === ""}
          onClick={() => setVendorId("")}
        >
          All items
        </button>
        {vendors.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`chip ${vendorId === v.id ? "chip-active" : ""}`}
            aria-pressed={vendorId === v.id}
            onClick={() => setVendorId(v.id)}
          >
            {v.name}
          </button>
        ))}
      </div>

      {!loaded ? (
        <ListSkeleton rows={6} height={52} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer rounded accent-brand-600"
                    aria-label="Select all"
                    checked={selected.size === items.length && items.length > 0}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())
                    }
                  />
                </th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Total spent</th>
                <th className="px-4 py-3">Dates bought</th>
                <th className="px-4 py-3 text-right">Reorder pt</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const t = catTint(i.category);
                return (
                  <tr
                    key={i.id}
                    className={`border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/40 ${!i.active ? "opacity-50" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer rounded accent-brand-600"
                        aria-label={`Select ${i.name}`}
                        checked={selected.has(i.id)}
                        onChange={() => toggle(i.id)}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400 dark:text-slate-500">{i.sku}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        {i.image_data ? (
                          <img
                            src={i.image_data}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <span className={`icon-tile h-8 w-8 rounded-lg ${t.tile}`}>
                            <Icon name={t.icon} size={16} />
                          </span>
                        )}
                        <button
                          className="text-left font-medium text-slate-800 transition-colors hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400"
                          onClick={() => openEdit(i)}
                        >
                          {i.name}
                        </button>
                        {!i.active && (
                          <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            Inactive
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {i.category && <span className={`badge ${t.badge}`}>{i.category}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {i.vendors && i.vendors.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {i.vendors.map((v) => (
                            <span
                              key={v}
                              className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                            >
                              {v}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const noStockVendor = i.vendors?.includes("Maurice Electrical Supply");
                        const onHand = Number(i.on_hand ?? 0);
                        if (i.on_hand === undefined) {
                          return <span className="text-slate-300 dark:text-slate-600">—</span>;
                        }
                        if (onHand === 0 && noStockVendor) {
                          return Number(i.used) > 0 ? (
                            <span className="text-xs text-slate-400 dark:text-slate-500">{i.used} used</span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">—</span>
                          );
                        }
                        return (
                          <span className="block">
                            <span
                              className={`font-semibold tabular-nums ${
                                onHand > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              {onHand > 0 ? `${i.on_hand} in stock` : "Out of stock"}
                            </span>
                            {Number(i.used) > 0 && (
                              <span className="block text-xs text-slate-400 dark:text-slate-500">
                                {i.used} used
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-slate-400 dark:text-slate-500">{i.unit}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="block font-semibold tabular-nums">{fmtMoney(i.avg_cost)}</span>
                      {i.last_cost !== i.avg_cost && (
                        <span className="block text-xs text-slate-400 dark:text-slate-500">
                          last {fmtMoney(i.last_cost)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {i.total_spent !== undefined ? fmtMoney(i.total_spent) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {i.dates_bought && i.dates_bought.length > 0 ? (
                        (() => {
                          const dates = i.dates_bought!;
                          const latest = dates[dates.length - 1];
                          const earlier = dates.slice(0, -1);
                          const expanded = datesExpanded.has(i.id);
                          return (
                            <span className="flex flex-wrap items-center gap-1">
                              <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                {fmtDate(latest)}
                              </span>
                              {earlier.length > 0 && (
                                <button
                                  type="button"
                                  className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                                  onClick={() =>
                                    setDatesExpanded((s) => {
                                      const n = new Set(s);
                                      if (n.has(i.id)) n.delete(i.id);
                                      else n.add(i.id);
                                      return n;
                                    })
                                  }
                                >
                                  {expanded ? "hide" : `+${earlier.length} more`}
                                </button>
                              )}
                              {expanded &&
                                earlier
                                  .slice()
                                  .reverse()
                                  .map((d) => (
                                    <span
                                      key={d}
                                      className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                                    >
                                      {fmtDate(d)}
                                    </span>
                                  ))}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{i.reorder_point}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                        onClick={() => setActive(i, !i.active)}
                      >
                        {i.active ? "Deactivate" : "Restore"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={12}>
                    <Empty icon="package" title="No items" hint="Adjust the search or add a new item." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setEditing(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editing === "new" ? "New item" : "Edit item"}
          >
            <div className="mb-5">
              <p className="page-eyebrow">{editing === "new" ? "New item" : "Edit item"}</p>
              <h2 className="truncate text-[19px] font-bold tracking-tight">
                {editing === "new" ? "Add to catalog" : editing.name}
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {F("SKU", "sku")}
              {F("Barcode (defaults to SKU)", "barcode")}
            </div>
            <div className="mt-3 space-y-3">
              {F("Name", "name")}
              <div className="flex items-end gap-3">
                <div className="flex-1">{F("Description", "description")}</div>
                <div className="flex flex-col items-center gap-1">
                  <span className="label">Photo</span>
                  <label className="relative flex h-[42px] w-[42px] cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-800">
                    {form.image_data ? (
                      <img src={form.image_data} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon name="camera" size={16} className="text-slate-300 dark:text-slate-600" />
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
                  </label>
                </div>
              </div>
              {form.image_data && (
                <button
                  type="button"
                  className="-mt-2 text-xs font-semibold text-slate-400 hover:text-red-500 dark:text-slate-500"
                  onClick={() => setForm((f) => ({ ...f, image_data: "" }))}
                >
                  Remove photo
                </button>
              )}
              <div className="grid grid-cols-2 gap-3">
                {F("Category", "category")}
                <label className="block">
                  <span className="label">Unit</span>
                  <select
                    className="input"
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  >
                    <option value="each">each</option>
                    <option value="box">box</option>
                    <option value="foot">foot</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {F("Reorder point", "reorder_point", "number")}
                {F("Reorder qty", "reorder_qty", "number")}
              </div>
              {F("Notes", "notes")}
            </div>
            <div className="mt-6 flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn-primary flex-1" disabled={saving} onClick={save}>
                {saving ? <Spinner /> : null}
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
