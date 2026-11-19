import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { createPortal } from "react-dom";

import { api } from "../../api";
import Icon from "../../components/Icon";
import { Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import type { Estimate, Item, Plan, PlanMarker, PlanSymbolType } from "../../types";

const SYMBOL_TYPES: { id: PlanSymbolType; label: string; color: string; letter: string }[] = [
  { id: "duplex", label: "Duplex Outlet", color: "#2f6fb5", letter: "O" },
  { id: "gfci", label: "GFCI Outlet", color: "#2f9bb5", letter: "G" },
  { id: "light", label: "Light Fixture", color: "#b8962f", letter: "L" },
  { id: "fan", label: "Ceiling Fan", color: "#2f8f7a", letter: "F" },
  { id: "exfan", label: "Exhaust Fan", color: "#1f6e5c", letter: "X" },
  { id: "switch", label: "Switch", color: "#7a4fb5", letter: "S" },
  { id: "smoke", label: "Smoke Detector", color: "#c23b3b", letter: "D" },
  { id: "co_smoke", label: "Combo Smoke/CO Detector", color: "#8a2424", letter: "C" },
  { id: "panel", label: "Panel / Equipment", color: "#5a5f66", letter: "P" },
];
const symbolOf = (id: PlanSymbolType) => SYMBOL_TYPES.find((t) => t.id === id) ?? SYMBOL_TYPES[0];

export default function PlanMarkupSheet({
  estimateId,
  onClose,
  onApplied,
  onApplyToChecklist,
}: {
  estimateId: number;
  onClose: () => void;
  // Either this or onApplyToChecklist is passed, not both. onApplied: the
  // default path (EstimateDetail's standalone "Plan" button) -- writes
  // real lines via POST .../plan/apply and hands back the updated
  // estimate. onApplyToChecklist: the wizard's "Mark up a plan" path --
  // skips that endpoint entirely and hands the raw markers to the caller,
  // which checks them off in the normal checklist steps instead.
  onApplied?: (e: Estimate) => void;
  onApplyToChecklist?: (markers: PlanMarker[]) => void;
}) {
  const toast = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pageId, setPageId] = useState<number | null>(null);
  const [placing, setPlacing] = useState<PlanSymbolType | null>(null);
  const [selected, setSelected] = useState<PlanMarker | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [applying, setApplying] = useState(false);
  const [autoLayoutRunning, setAutoLayoutRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [zoom, setZoom] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: number; moved: boolean } | null>(null);
  const panState = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const didPanRef = useRef(false);

  const load = () => {
    api<Plan>(`/estimates/${estimateId}/plan`)
      .then((p) => {
        setPlan(p);
        if (p.pages.length && !pageId) setPageId(p.pages[0].id);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [estimateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(() => {
      api<Item[]>(`/items?search=${encodeURIComponent(itemSearch)}`).then((r) => setItemResults(r.slice(0, 15))).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [itemSearch, selected]);

  const page = plan?.pages.find((p) => p.id === pageId) ?? null;

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const p = await api<Plan>(`/estimates/${estimateId}/plan/upload`, {
        method: "POST",
        body: { filename: file.name, data: dataUrl },
      });
      setPlan(p);
      setPageId(p.pages[0]?.id ?? null);
      toast("success", `Plan loaded -- ${p.pages.length} page${p.pages.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not read that plan");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const runAutoLayout = async () => {
    setAutoLayoutRunning(true);
    try {
      const p = await api<Plan>(`/estimates/${estimateId}/plan/auto-layout`, { method: "POST" });
      setPlan(p);
      const count = p.pages.reduce((n, pg) => n + pg.markers.length, 0);
      toast("success", `${count} code-minimum symbol${count === 1 ? "" : "s"} placed -- review and edit below`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not read the plan for a code layout");
    } finally {
      setAutoLayoutRunning(false);
    }
  };

  const stagePercent = (clientX: number, clientY: number) => {
    const rect = stageRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  };

  const addMarker = async (clientX: number, clientY: number) => {
    if (!placing || !page) return;
    const { x, y } = stagePercent(clientX, clientY);
    try {
      const m = await api<PlanMarker>(`/estimates/${estimateId}/plan/markers`, {
        method: "POST",
        body: { plan_page_id: page.id, symbol_type: placing, label: symbolOf(placing).label, qty: "1", x: String(x), y: String(y) },
      });
      setPlan((p) => (p ? { ...p, pages: p.pages.map((pg) => (pg.id === page.id ? { ...pg, markers: [...pg.markers, m] } : pg)) } : p));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not add that pin");
    }
  };

  const patchMarker = async (id: number, patch: Partial<PlanMarker> & { clear_item?: boolean }) => {
    try {
      const m = await api<PlanMarker>(`/estimates/${estimateId}/plan/markers/${id}`, { method: "PATCH", body: patch });
      setPlan((p) => (p ? { ...p, pages: p.pages.map((pg) => ({ ...pg, markers: pg.markers.map((x) => (x.id === id ? m : x)) })) } : p));
      if (selected?.id === id) setSelected(m);
      return m;
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save that change");
      return null;
    }
  };

  const deleteMarker = async (id: number) => {
    try {
      await api(`/estimates/${estimateId}/plan/markers/${id}`, { method: "DELETE" });
      setPlan((p) => (p ? { ...p, pages: p.pages.map((pg) => ({ ...pg, markers: pg.markers.filter((x) => x.id !== id) })) } : p));
      setSelected(null);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not remove that pin");
    }
  };

  const onPinPointerDown = (m: PlanMarker, e: React.PointerEvent) => {
    e.stopPropagation();
    dragState.current = { id: m.id, moved: false };
    const onMove = (mv: PointerEvent) => {
      if (!dragState.current) return;
      dragState.current.moved = true;
      const { x, y } = stagePercent(mv.clientX, mv.clientY);
      setPlan((p) =>
        p
          ? { ...p, pages: p.pages.map((pg) => ({ ...pg, markers: pg.markers.map((mk) => (mk.id === m.id ? { ...mk, x: String(x), y: String(y) } : mk)) })) }
          : p,
      );
    };
    const onUp = (up: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const moved = dragState.current?.moved;
      dragState.current = null;
      if (moved) {
        const { x, y } = stagePercent(up.clientX, up.clientY);
        patchMarker(m.id, { x: String(x), y: String(y) });
      } else {
        setSelected(m);
        setItemSearch("");
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  // Click-to-drag panning for when the plan is zoomed past the stage's
  // width/height -- scrollbars alone are slow for a big image, and this is
  // the expected gesture (map/photo-viewer style). Only counts as a pan
  // once the pointer actually moves past a small threshold, so a plain
  // click still places/selects a pin exactly as before.
  const onStagePointerDown = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage) return;
    panState.current = { x: e.clientX, y: e.clientY, scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop };
    didPanRef.current = false;
    const onMove = (mv: PointerEvent) => {
      const start = panState.current;
      if (!start) return;
      const dx = mv.clientX - start.x;
      const dy = mv.clientY - start.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didPanRef.current = true;
      if (didPanRef.current) {
        stage.scrollLeft = start.scrollLeft - dx;
        stage.scrollTop = start.scrollTop - dy;
      }
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      panState.current = null;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const pageMarkers = page?.markers ?? [];
  const allMarkers = plan?.pages.flatMap((p) => p.markers) ?? [];
  const matchedCount = allMarkers.filter((m) => m.item_id).length;
  const countsByType = SYMBOL_TYPES.map((t) => ({
    ...t,
    qty: allMarkers.filter((m) => m.symbol_type === t.id).reduce((n, m) => n + (parseFloat(m.qty) || 0), 0),
  })).filter((t) => t.qty > 0);

  const apply = async () => {
    if (onApplyToChecklist) {
      onApplyToChecklist(allMarkers);
      return;
    }
    setApplying(true);
    try {
      const est = await api<Estimate>(`/estimates/${estimateId}/plan/apply`, { method: "POST" });
      toast("success", `Applied -- ${allMarkers.length} line item${allMarkers.length === 1 ? "" : "s"} synced to the estimate`);
      // Doesn't close -- keep editing/adding pins and hit Apply again any
      // time; each apply replaces the lines from the previous one rather
      // than piling up duplicates, so it's safe to re-run after any edit.
      onApplied?.(est);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not apply the plan");
    } finally {
      setApplying(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex flex-col bg-slate-950/60 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="mx-auto my-3 flex w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sheet dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <div>
            <h2 className="text-[15px] font-bold">Mark up plan</h2>
            {plan?.confidence_note && (
              <p className="max-w-md text-[12px] text-amber-600 dark:text-amber-400">{plan.confidence_note}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary !min-h-[32px] px-3 text-[12.5px]" onClick={onClose}>
              Done
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center"><Spinner /></div>
        ) : !plan || plan.pages.length === 0 ? (
          <div
            className={`m-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
              dragActive ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-200 dark:border-slate-700"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            <Icon name="upload" size={28} className="text-slate-300 dark:text-slate-600" />
            <p className="text-[14px] text-slate-500 dark:text-slate-400">
              Drag a plan PDF here, or upload one. You'll be able to apply a code-minimum layout automatically, then edit it by hand.
            </p>
            <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <button className="btn-primary" disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? <Spinner /> : <Icon name="upload" size={18} />}
              {uploading ? "Reading plan…" : "Upload plan (PDF)"}
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="mb-2.5 flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 dark:border-brand-500/30 dark:bg-brand-500/10">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">Apply code-minimum symbols</p>
                  <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                    Reads every page and places a starting layout per room -- review and edit it after.
                  </p>
                </div>
                <button className="btn-primary !min-h-[36px] shrink-0 px-3 text-[12.5px]" disabled={autoLayoutRunning} onClick={runAutoLayout}>
                  {autoLayoutRunning ? <Spinner /> : <Icon name="zap" size={14} />}
                  {autoLayoutRunning ? "Reading…" : "Apply code-minimum symbols"}
                </button>
              </div>
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                {plan.pages.map((p) => (
                  <button
                    key={p.id}
                    className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
                      p.id === pageId
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                    onClick={() => { setPageId(p.id); setSelected(null); setZoom(1); }}
                  >
                    Page {p.page_number}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1 py-1 dark:border-slate-700 dark:bg-slate-800">
                  <button
                    className="icon-btn !h-[26px] !w-[26px]"
                    disabled={zoom <= 1}
                    onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 10) / 10))}
                    aria-label="Zoom out"
                  >
                    <Icon name="minus" size={14} />
                  </button>
                  <span className="min-w-[34px] text-center text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    className="icon-btn !h-[26px] !w-[26px]"
                    disabled={zoom >= 4}
                    onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.5) * 10) / 10))}
                    aria-label="Zoom in"
                  >
                    <Icon name="plus" size={14} />
                  </button>
                </div>
                <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                <button className="btn-secondary !min-h-[32px] px-2.5 text-[12px]" disabled={uploading} onClick={() => fileInput.current?.click()}>
                  {uploading ? <Spinner /> : <Icon name="upload" size={14} />}
                  {uploading ? "Reading…" : "Replace plan"}
                </button>
              </div>

              <div
                ref={stageRef}
                className={`relative min-h-0 flex-1 overflow-auto rounded-xl border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 ${placing ? "cursor-copy" : "cursor-grab active:cursor-grabbing"}`}
                onPointerDown={onStagePointerDown}
                onClick={(e) => {
                  if (didPanRef.current) { didPanRef.current = false; return; }
                  if (placing) addMarker(e.clientX, e.clientY);
                }}
              >
                {page && (
                  // Pins are a fixed CSS pixel size (see below) and never
                  // scale with this wrapper's width -- so zooming the plan
                  // in makes pins cover a smaller fraction of it, which is
                  // the point: zoom in to see true proportion/placement
                  // instead of a giant pin hiding the detail under it.
                  <div className="relative inline-block" style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
                    <img src={page.image_data} alt={`Plan page ${page.page_number}`} className="block w-full select-none" draggable={false} />
                    {pageMarkers.map((m) => {
                      const s = symbolOf(m.symbol_type);
                      const qty = parseFloat(m.qty) || 0;
                      return (
                        <div
                          key={m.id}
                          className="absolute flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow active:cursor-grabbing"
                          style={{ left: `${m.x}%`, top: `${m.y}%`, background: s.color, outline: selected?.id === m.id ? "2px solid #1c2024" : undefined, outlineOffset: 2 }}
                          onPointerDown={(e) => onPinPointerDown(m, e)}
                          title={`${m.label} ×${qty}`}
                        >
                          {s.letter}
                          {qty > 1 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-slate-900 px-0.5 text-[9px] text-white dark:bg-slate-100 dark:text-slate-900">
                              {qty}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <p className="mt-2 text-[12px] text-slate-400 dark:text-slate-500">
                {pageMarkers.length} symbol{pageMarkers.length === 1 ? "" : "s"} on this page · {matchedCount} of {allMarkers.length} matched to a catalog item
              </p>
            </div>

            <div className="flex w-full shrink-0 flex-col gap-1.5 overflow-y-auto border-t border-slate-100 p-4 dark:border-slate-800 md:w-64 md:border-l md:border-t-0">
              {countsByType.length > 0 && (
                <>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Counts (whole plan)</p>
                  <div className="mb-2 flex flex-col gap-1 rounded-xl border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950">
                    {countsByType.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-[12.5px]">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                        <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{t.label}</span>
                        <span className="font-mono font-bold tabular-nums">{t.qty % 1 === 0 ? t.qty : t.qty.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Add a symbol</p>
              {SYMBOL_TYPES.map((t) => (
                <button
                  key={t.id}
                  className={`card-interactive flex items-center gap-2 p-2.5 text-left text-[12.5px] font-semibold ${placing === t.id ? "ring-2 ring-brand-500" : ""}`}
                  onClick={() => setPlacing(placing === t.id ? null : t.id)}
                >
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: t.color }} />
                  {t.label}
                </button>
              ))}
              <p className="mt-1 text-[11.5px] text-slate-400 dark:text-slate-500">
                {placing ? `Click the plan to drop a ${symbolOf(placing).label.toLowerCase()} pin.` : "Pick a symbol, then click the plan."}
              </p>

              <button className="btn-primary mt-3" disabled={applying || allMarkers.length === 0} onClick={apply}>
                {applying ? <Spinner /> : <Icon name="check" size={16} />}
                Apply to estimate
              </button>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {onApplyToChecklist
                  ? "Checks off the regular estimate questions using the counts above (adding a custom item where nothing matches) so you can review and add more before finishing."
                  : "Creates real line items from every pin above -- matched pins price from the catalog, unmatched ones go in at $0 material to fix up after. Keep editing pins and hit this again any time -- it updates the estimate's lines instead of duplicating them."}
              </p>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/40 p-4"
          onClick={() => setSelected(null)}
        >
          <div className="w-full max-w-xs rounded-2xl bg-white p-4 shadow-sheet dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <span className="label">Type</span>
            <select
              className="input mb-2.5"
              value={selected.symbol_type}
              onChange={(e) => patchMarker(selected.id, { symbol_type: e.target.value as PlanSymbolType })}
            >
              {SYMBOL_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <span className="label">Label</span>
            <input
              className="input mb-2.5"
              value={selected.label}
              onChange={(e) => setSelected({ ...selected, label: e.target.value })}
              onBlur={(e) => patchMarker(selected.id, { label: e.target.value })}
            />
            <span className="label">Quantity</span>
            <input
              className="input mb-2.5"
              type="number"
              min="0"
              step="any"
              value={selected.qty}
              onChange={(e) => setSelected({ ...selected, qty: e.target.value })}
              onBlur={(e) => patchMarker(selected.id, { qty: e.target.value })}
            />

            <span className="label">Catalog item</span>
            {selected.item_id ? (
              <div className="mb-2.5 flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <span className="min-w-0 truncate text-[13px] font-medium">{selected.item_name}</span>
                <button
                  className="icon-btn !h-7 !w-7 shrink-0"
                  onClick={async () => { const m = await patchMarker(selected.id, { clear_item: true }); if (m) setItemSearch(""); }}
                  aria-label="Unlink item"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ) : (
              <div className="mb-2.5 space-y-1.5">
                <input
                  className="input"
                  placeholder="Search item name or SKU…"
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                />
                {itemSearch.trim().length > 0 && (
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {itemResults.map((r) => (
                      <button
                        key={r.id}
                        className="card-interactive flex w-full items-center gap-2 p-2 text-left text-[12.5px]"
                        onClick={() => patchMarker(selected.id, { item_id: r.id })}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{r.sku}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button className="btn-secondary flex-1" onClick={() => setSelected(null)}>Close</button>
              <button className="btn-secondary flex-1 !bg-red-500 !text-white" onClick={() => deleteMarker(selected.id)}>
                Delete pin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
