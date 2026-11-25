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

// Distinct, high-contrast colors for the Legend prompt -- several Legend
// items often share the same generic symbol_type bucket (e.g. half a dozen
// different light fixtures are all type "light"), which would otherwise all
// render identically on the plan. Each legend item gets its own color from
// here instead of the bucket's.
const LEGEND_PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#17a2b8",
  "#f032e6", "#469990", "#9a6324", "#800000", "#808000", "#000075",
  "#c2185b", "#5d4037", "#0097a7", "#7cb342",
];

// Every item from the "Rough-In Electrical Work" checklist step (kept in
// sync with WIZARD_STEPS in EstimateWizard.tsx by hand, same as the
// Install Customer-Supplied Fixtures list already is), each tagged with the
// closest symbol type for its pin's icon/color -- placing one sets the
// marker's label to the item's exact name, not the generic bucket label,
// so "Apply to estimate" can match it to this exact checklist item.
const ROUGH_IN_ITEMS: { group: string; type: PlanSymbolType; item: string }[] = [
  ...([
    "Recessed Lights", "Chandeliers", "Pendant Lights", "Exterior Light", "Exterior Floodlights",
    "Basement Lights", "Crawl Space Lights", "Vanity Lights", "Reading Lights", "Tub Pendant",
    "Closet Lights", "Under Cabinet Lights", "Wall Sconces", "Emergency Lights", "EXIT Lights",
    "Combo EXIT/Emergency Lights", "2x2 Lights", "2x4 Lights",
  ].map((item) => ({ group: "Fixtures", type: "light" as PlanSymbolType, item }))),
  { group: "Fixtures", type: "exfan", item: "Exhaust Fans" },
  { group: "Fixtures", type: "fan", item: "Ceiling Fans" },
  { group: "Fixtures", type: "co_smoke", item: "Combination CO/Smoke Detectors" },
  { group: "Fixtures", type: "smoke", item: "Smoke Detectors" },
  { group: "Fixtures", type: "panel", item: "Baseboard Heaters" },
  ...([
    "Single-Pole Toggle Switches", "Three-Way Toggle Switches", "Four-Way Toggle Switches",
    "Dimmer Switches", "Occupancy Sensor Switches",
  ].map((item) => ({ group: "Switches & Outlets", type: "switch" as PlanSymbolType, item }))),
  { group: "Switches & Outlets", type: "duplex", item: "Duplex Outlets" },
  { group: "Switches & Outlets", type: "duplex", item: "Quad Outlets" },
  { group: "Switches & Outlets", type: "gfci", item: "GFCI Outlet" },
  { group: "Switches & Outlets", type: "gfci", item: "Waterproof GFCI Outlet" },
  ...([
    "Dishwasher Outlet", "Disposal Outlet", "Microwave Outlet", "Oven/Range Outlet",
    "Refrigerator Outlet", "Washer Outlet", "Dryer Outlet", "Garage Door Opener Outlet", "TV Outlet",
    "Data Outlet (CAT5e)", "Thermostat",
  ].map((item) => ({ group: "Switches & Outlets", type: "duplex" as PlanSymbolType, item }))),
  ...([
    "New HVAC Indoor & Outdoor Unit", "New Kitchen Hood", "New Water Heater", "Sump Pump",
  ].map((item) => ({ group: "Equipment", type: "panel" as PlanSymbolType, item }))),
];

// Same idea as ROUGH_IN_ITEMS above, but for a commercial job -- kept in
// sync by hand with "Commercial Rough-In" in EstimateWizard.tsx. Used
// instead of ROUGH_IN_ITEMS whenever the estimate being marked up is
// commercial, since the residential list's item names don't match
// anything in the commercial checklist "Apply to estimate" routes into.
const COMMERCIAL_ROUGH_IN_ITEMS: { group: string; type: PlanSymbolType; item: string }[] = [
  ...([
    'Recessed Light (4")', 'Recessed Light (6")', "Recessed Light w/ Battery Backup", "2x2 Light",
    "2x2 Light w/ Battery Backup", "LED Pendant Light", "LED Pendant Light w/ Battery Backup",
    "Wall Sconce", "Exterior Wall Sconce w/ Battery Backup", "Exterior Recessed Light",
    "Exterior Recessed Light w/ Battery Backup", "Exterior Light", "Exterior Wall Lamp",
    "4' Linear Light", "2' Linear Light", "Elevator Machine Room Light", "EXIT Sign (Single-Sided)",
    "EXIT Sign (Double-Sided)", "EXIT Sign w/ Directional Arrow", "Emergency Light",
    "Combo EXIT/Emergency Light", "Combo EXIT/Emergency Light w/ Remote Exterior Head",
    "Ceiling Mounted Occupancy Sensor", "LED Bathroom Vanity Light", "LED Surface-Mounted Utility Light",
  ].map((item) => ({ group: "Fixtures", type: "light" as PlanSymbolType, item }))),
  ...([
    "Push Button Switch (Standard)", "Push Button Switch (Basic)", "Toggle Switch", "Occupancy Sensor Switch",
  ].map((item) => ({ group: "Switches & Outlets", type: "switch" as PlanSymbolType, item }))),
  { group: "Switches & Outlets", type: "duplex", item: "Duplex Outlet" },
  { group: "Switches & Outlets", type: "duplex", item: "Duplex Outlet w/ Plug-Load Control" },
  { group: "Switches & Outlets", type: "duplex", item: "Quad Outlet" },
  { group: "Switches & Outlets", type: "duplex", item: "Quad Outlet w/ Plug-Load Control" },
  { group: "Switches & Outlets", type: "duplex", item: "Quad Floor Outlet" },
  { group: "Switches & Outlets", type: "gfci", item: "GFCI Outlet" },
  { group: "Switches & Outlets", type: "gfci", item: "Weatherproof GFCI Outlet" },
  { group: "Switches & Outlets", type: "duplex", item: "Specialty Outlet" },
  { group: "Switches & Outlets", type: "duplex", item: "Sign Receptacle" },
  { group: "Switches & Outlets", type: "duplex", item: "Data Outlet" },
  { group: "Equipment", type: "panel", item: "Air Handler" },
  { group: "Equipment", type: "panel", item: "Furnace" },
  { group: "Equipment", type: "panel", item: "Condenser" },
  { group: "Equipment", type: "panel", item: "Rooftop Unit" },
  { group: "Equipment", type: "exfan", item: "Exhaust Fan" },
  { group: "Equipment", type: "panel", item: "Water Heater" },
  { group: "Equipment", type: "panel", item: "Baseboard Heater" },
  { group: "Equipment", type: "panel", item: "Motorized Damper" },
  { group: "Equipment", type: "panel", item: "Fire Alarm Control Panel" },
  { group: "Equipment", type: "panel", item: "Circulator Pump" },
  { group: "Equipment", type: "panel", item: "Hand Dryer" },
  { group: "Equipment", type: "panel", item: "Car Charger" },
];

export default function PlanMarkupSheet({
  estimateId,
  jobType = "residential",
  onClose,
  onApplied,
  onApplyToChecklist,
}: {
  estimateId: number;
  // Picks which "Rough-in items" palette to show -- the two checklists use
  // different item names entirely, so placing a commercial plan's symbols
  // from the residential list would never match anything on
  // "Apply to estimate". Defaults to residential since EstimateDetail's
  // standalone "Plan" button doesn't otherwise know the job type up front.
  jobType?: "residential" | "commercial";
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
  const [placing, setPlacing] = useState<{ type: PlanSymbolType; label: string } | null>(null);
  const [paletteFilter, setPaletteFilter] = useState("");
  const [selected, setSelected] = useState<PlanMarker | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [applying, setApplying] = useState(false);
  const [autoLayoutRunning, setAutoLayoutRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [zoom, setZoom] = useState(1);
  // Items picked (via the legend prompt below, or starred one at a time
  // from the full Rough-in list) as what's actually on this plan's own
  // electrical legend -- each gets its own color from LEGEND_PALETTE so
  // same-bucket items (several different light fixtures are all type
  // "light") are still visually distinct on the plan, and they take over
  // the "Quick symbols" slot as the main, fastest things to click.
  // Persisted per-estimate (not per-page) since the same legend applies
  // across the whole plan set, and survives reopening this sheet later.
  const legendKey = `shopstock:planLegend:${estimateId}`;
  const [legendColors, setLegendColors] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(legendKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      // Older versions of this sheet stored the legend as a plain string
      // array (no colors) -- fall back to assigning colors fresh instead
      // of losing an already-built legend on first load after the update.
      if (Array.isArray(parsed)) {
        const next: Record<string, string> = {};
        parsed.forEach((item: string, i: number) => { next[item] = LEGEND_PALETTE[i % LEGEND_PALETTE.length]; });
        return next;
      }
      return parsed;
    } catch {
      return {};
    }
  });
  const saveLegendColors = (next: Record<string, string>) => {
    setLegendColors(next);
    try { localStorage.setItem(legendKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const nextLegendColor = (used: Set<string>, ordinal: number) =>
    LEGEND_PALETTE.find((c) => !used.has(c)) ?? LEGEND_PALETTE[ordinal % LEGEND_PALETTE.length];
  const toggleLegend = (item: string) => {
    const next = { ...legendColors };
    if (item in next) {
      delete next[item];
    } else {
      next[item] = nextLegendColor(new Set(Object.values(next)), Object.keys(next).length);
    }
    saveLegendColors(next);
  };
  const colorFor = (item: string, type: PlanSymbolType) => legendColors[item] ?? symbolOf(type).color;

  // The "what's on this plan's legend?" prompt -- opens once automatically
  // the first time a plan with pages has no legend set yet, so it's asked
  // up front before marking up starts, not discovered one star at a time.
  const [legendPromptOpen, setLegendPromptOpen] = useState(false);
  const [legendDraft, setLegendDraft] = useState<Set<string>>(new Set());
  const autoPromptedRef = useRef(false);
  const openLegendPrompt = () => {
    setLegendDraft(new Set(Object.keys(legendColors)));
    setLegendPromptOpen(true);
  };
  const confirmLegendPrompt = () => {
    const next: Record<string, string> = {};
    const used = new Set<string>();
    let ordinal = 0;
    for (const item of legendDraft) {
      if (legendColors[item]) { next[item] = legendColors[item]; used.add(legendColors[item]); }
    }
    for (const item of legendDraft) {
      if (!next[item]) { next[item] = nextLegendColor(used, ordinal); used.add(next[item]); }
      ordinal += 1;
    }
    saveLegendColors(next);
    setLegendPromptOpen(false);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // The zoomable image wrapper, not the outer scrollable stage -- its
  // getBoundingClientRect() reflects the image's actual on-screen size and
  // position regardless of zoom or how far the stage is scrolled, which
  // stageRef's rect does not (that's the viewport, not the content).
  const wrapRef = useRef<HTMLDivElement>(null);
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
    if (autoPromptedRef.current || loading) return;
    if (!plan || plan.pages.length === 0) return;
    if (Object.keys(legendColors).length > 0) return;
    autoPromptedRef.current = true;
    openLegendPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, plan]);

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
    const rect = wrapRef.current!.getBoundingClientRect();
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
        body: { plan_page_id: page.id, symbol_type: placing.type, label: placing.label, qty: "1", x: String(x), y: String(y) },
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
      setPlacing(null);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not remove that pin");
    }
  };

  const clearAllMarkers = async () => {
    if (!confirm("Clear every symbol on every page of this plan? This can't be undone.")) return;
    try {
      await api(`/estimates/${estimateId}/plan/markers`, { method: "DELETE" });
      setPlan((p) => (p ? { ...p, pages: p.pages.map((pg) => ({ ...pg, markers: [] })) } : p));
      setSelected(null);
      toast("success", "Cleared every symbol from the plan");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not clear the plan's symbols");
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
        // Disarm any symbol still armed from the palette -- otherwise the
        // very next click on the stage (e.g. clicking where this pin was,
        // to check it's gone) immediately drops a fresh pin there, making
        // a deleted pin look like it "didn't go away".
        setPlacing(null);
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
  // By label, not just symbol_type -- placed pins now carry a specific
  // item name (e.g. "Recessed Lights" vs "Chandeliers", both type "light"),
  // so a bucket-level count would wrongly lump different items together.
  const countsByLabel = Object.values(
    allMarkers.reduce<Record<string, { label: string; color: string; qty: number }>>((acc, m) => {
      const key = m.label;
      const qty = parseFloat(m.qty) || 0;
      if (!acc[key]) acc[key] = { label: m.label, color: colorFor(m.label, m.symbol_type), qty: 0 };
      acc[key].qty += qty;
      return acc;
    }, {}),
  ).sort((a, b) => a.label.localeCompare(b.label));

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
                <button
                  className="btn-secondary !min-h-[32px] px-2.5 text-[12px] !text-red-600 dark:!text-red-400"
                  disabled={allMarkers.length === 0}
                  onClick={clearAllMarkers}
                >
                  <Icon name="trash" size={14} />
                  Clear all symbols
                </button>
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
                  <div ref={wrapRef} className="relative inline-block" style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
                    <img src={page.image_data} alt={`Plan page ${page.page_number}`} className="block w-full select-none" draggable={false} />
                    {pageMarkers.map((m) => {
                      const s = symbolOf(m.symbol_type);
                      const color = colorFor(m.label, m.symbol_type);
                      const qty = parseFloat(m.qty) || 0;
                      return (
                        <div
                          key={m.id}
                          className="absolute flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow active:cursor-grabbing"
                          style={{ left: `${m.x}%`, top: `${m.y}%`, background: color, outline: selected?.id === m.id ? "2px solid #1c2024" : undefined, outlineOffset: 2 }}
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
              {countsByLabel.length > 0 && (
                <>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Counts (whole plan)</p>
                  <div className="mb-2 flex flex-col gap-1 rounded-xl border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950">
                    {countsByLabel.map((t) => (
                      <div key={t.label} className="flex items-center gap-2 text-[12.5px]">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                        <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{t.label}</span>
                        <span className="font-mono font-bold tabular-nums">{t.qty % 1 === 0 ? t.qty : t.qty.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {(() => {
                const paletteItems = jobType === "commercial" ? COMMERCIAL_ROUGH_IN_ITEMS : ROUGH_IN_ITEMS;
                const legendItems = paletteItems.filter((r) => r.item in legendColors);
                const hasLegend = legendItems.length > 0;
                return (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        {hasLegend ? `Legend (${legendItems.length})` : "Quick symbols"}
                      </p>
                      <button className="text-[11px] font-semibold text-brand-600 dark:text-brand-400" onClick={openLegendPrompt}>
                        {hasLegend ? "Edit" : "Set up"}
                      </button>
                    </div>
                    {hasLegend ? (
                      legendItems.map((r) => {
                        const active = placing?.type === r.type && placing.label === r.item;
                        return (
                          <button
                            key={r.item}
                            className={`card-interactive flex items-center gap-2 p-2.5 text-left text-[12.5px] font-semibold ${active ? "ring-2 ring-brand-500" : ""}`}
                            onClick={() => setPlacing(active ? null : { type: r.type, label: r.item })}
                          >
                            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: legendColors[r.item] }} />
                            {r.item}
                          </button>
                        );
                      })
                    ) : (
                      <>
                        {jobType === "commercial" && (
                          <p className="mb-1 text-[11px] text-slate-400 dark:text-slate-500">
                            "Panel" here means panels/disconnects only -- for HVAC, water heaters, and other
                            equipment, use the named items in the Equipment group below instead, so each type
                            gets counted and priced on its own.
                          </p>
                        )}
                        {SYMBOL_TYPES.map((t) => (
                          <button
                            key={t.id}
                            className={`card-interactive flex items-center gap-2 p-2.5 text-left text-[12.5px] font-semibold ${placing?.type === t.id && placing.label === t.label ? "ring-2 ring-brand-500" : ""}`}
                            onClick={() => setPlacing(placing?.type === t.id && placing.label === t.label ? null : { type: t.id, label: t.label })}
                          >
                            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: t.color }} />
                            {jobType === "commercial" && t.id === "panel" ? "Panel" : t.label}
                          </button>
                        ))}
                      </>
                    )}
                  </>
                );
              })()}

              <p className="mb-1 mt-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Rough-in items</p>
              <p className="mb-1 text-[11px] text-slate-400 dark:text-slate-500">
                Tap the star to pin an item to the Legend above.
              </p>
              <input
                className="input mb-1 !min-h-[30px] text-[12.5px]"
                placeholder="Filter…"
                value={paletteFilter}
                onChange={(e) => setPaletteFilter(e.target.value)}
              />
              {["Fixtures", "Switches & Outlets", "Equipment"].map((group) => {
                const items = (jobType === "commercial" ? COMMERCIAL_ROUGH_IN_ITEMS : ROUGH_IN_ITEMS).filter(
                  (r) => r.group === group && r.item.toLowerCase().includes(paletteFilter.trim().toLowerCase()),
                );
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="mb-0.5 mt-1.5 text-[10.5px] font-semibold text-slate-400 dark:text-slate-500">{group}</p>
                    {items.map((r) => {
                      const active = placing?.type === r.type && placing.label === r.item;
                      const pinned = r.item in legendColors;
                      return (
                        <div key={r.item} className="flex items-center gap-1">
                          <button
                            className={`card-interactive flex w-full min-w-0 items-center gap-2 p-2 text-left text-[12px] font-semibold ${active ? "ring-2 ring-brand-500" : ""}`}
                            onClick={() => setPlacing(active ? null : { type: r.type, label: r.item })}
                          >
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorFor(r.item, r.type) }} />
                            <span className="min-w-0 flex-1 truncate">{r.item}</span>
                          </button>
                          <button
                            className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:text-amber-500 dark:text-slate-600"
                            title={pinned ? "Remove from Legend" : "Pin to Legend"}
                            onClick={() => toggleLegend(r.item)}
                          >
                            <Icon name="star" size={16} filled={pinned} className={pinned ? "text-amber-500" : ""} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              <p className="mt-1 text-[11.5px] text-slate-400 dark:text-slate-500">
                {placing ? `Click the plan to drop a ${placing.label.toLowerCase()} pin.` : "Pick a symbol, then click the plan."}
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

      {legendPromptOpen && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/40 p-4"
          onClick={() => setLegendPromptOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl bg-white p-4 shadow-sheet dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-[15px] font-bold">What's on this plan's legend?</p>
            <p className="mb-2 text-[12.5px] text-slate-400 dark:text-slate-500">
              Select every symbol on the plan's own electrical legend -- each gets its own color and
              goes to the top of the symbol list so you can place it with one tap.
            </p>
            <input
              className="input mb-1 !min-h-[30px] text-[12.5px]"
              placeholder="Filter…"
              value={paletteFilter}
              onChange={(e) => setPaletteFilter(e.target.value)}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {["Fixtures", "Switches & Outlets", "Equipment"].map((group) => {
                const items = (jobType === "commercial" ? COMMERCIAL_ROUGH_IN_ITEMS : ROUGH_IN_ITEMS).filter(
                  (r) => r.group === group && r.item.toLowerCase().includes(paletteFilter.trim().toLowerCase()),
                );
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="mb-0.5 mt-1.5 text-[10.5px] font-semibold text-slate-400 dark:text-slate-500">{group}</p>
                    {items.map((r) => {
                      const checked = legendDraft.has(r.item);
                      return (
                        <button
                          key={r.item}
                          className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-[12.5px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                          onClick={() => setLegendDraft((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.item)) next.delete(r.item); else next.add(r.item);
                            return next;
                          })}
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-brand-500 bg-brand-500" : "border-slate-300 dark:border-slate-600"}`}>
                            {checked && <Icon name="check" size={12} className="text-white" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{r.item}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 pt-2">
              <button className="btn-secondary flex-1" onClick={() => setLegendPromptOpen(false)}>
                {Object.keys(legendColors).length > 0 ? "Cancel" : "Skip for now"}
              </button>
              <button className="btn-primary flex-1" onClick={confirmLegendPrompt}>
                Set legend {legendDraft.size > 0 ? `(${legendDraft.size})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
