import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";

import { api, fmtQty } from "../../api";
import { useAuth } from "../../auth";
import { useCart } from "../../cart";
import { catTint } from "../../catcolor";
import Icon from "../../components/Icon";
import JobPicker from "../../components/JobPicker";
import QtyPad from "../../components/QtyPad";
import Sheet from "../../components/Sheet";
import { ItemThumb, PageLoader, Spinner, SuccessCheck } from "../../components/ui";
import { useToast } from "../../toast";
import type { Item, ItemStock, Job, Location } from "../../types";

type Mode = "signout" | "return" | "transfer";
type Step = "qty" | "route" | "route-truck" | "destination" | "job" | "location" | "confirm" | "success";
/** Only meaningful when mode === "signout": which of the two Take Out
 * destinations the tech picked. */
type SignoutDest = "truck" | "job" | null;

const MODE_LABEL: Record<Mode, string> = {
  signout: "Take Out",
  return: "Return",
  transfer: "Transfer",
};

/** Small non-interactive pill used on the confirm screen's from → to line. */
function RouteChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-[42%] items-center rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <span className="truncate">{children}</span>
    </span>
  );
}

export default function ItemSheet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const cart = useCart();
  const { myTruck } = useAuth();

  const [item, setItem] = useState<Item | null>(null);
  const [stock, setStock] = useState<ItemStock | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);

  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>("qty");
  const [qty, setQty] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [signoutDest, setSignoutDest] = useState<SignoutDest>(null);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [destId, setDestId] = useState<number | null>(null);
  const [transferFromId, setTransferFromId] = useState<number | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [showAllLocations, setShowAllLocations] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Item>(`/items/${id}`).then(setItem).catch(() => navigate("/search"));
    api<ItemStock>(`/items/${id}/stock`).then(setStock).catch(() => {});
    api<Location[]>("/locations").then(setLocations).catch(() => {});
  }, [id, navigate]);

  useEffect(load, [load]);

  const shopRow = stock?.locations.find((l) => l.location_type === "shop");
  const truckRow = stock?.locations.find((l) => l.location_id === myTruck?.location_id);
  const shopLoc = locations.find((l) => l.type === "shop");
  const truck1 = locations.find((l) => l.name === "Truck 1");
  const truck2 = locations.find((l) => l.name === "Truck 2");
  const truck3 = locations.find((l) => l.name === "Truck 3");
  const allTrucks = [truck1, truck2, truck3];

  const stockAt = (locId: number | undefined) =>
    locId ? parseFloat(stock?.locations.find((l) => l.location_id === locId)?.qty ?? "0") : 0;
  // Trucks that actually hold this item right now -- drives whether we ask
  // the 3-way "stock->truck / truck->job / stock->job" routing question.
  const trucksWithStock = allTrucks.filter((t) => t && stockAt(t.id) > 0) as Location[];
  const hasTruckStock = trucksWithStock.length > 0;

  const defaultSource = (q: string): number | null => {
    // default to My Truck if it holds >= qty, else Shop
    if (myTruck && truckRow && parseFloat(truckRow.qty) >= parseFloat(q || "0"))
      return myTruck.location_id;
    return shopLoc?.id ?? null;
  };

  const begin = (m: Mode) => {
    setMode(m);
    setStep("qty");
    setQty("");
    setJob(null);
    setSignoutDest(null);
    setSourceId(null);
    setDestId(null);
    setTransferFromId(null);
    setShowAllLocations(false);
    setSaving(false);
  };

  const close = () => setMode(null);

  /** Waits for the server to confirm the transaction before showing success —
   * a blocked oversell or network failure surfaces as an error, never a false
   * "Signed out" checkmark. */
  const doConfirm = async () => {
    if (!item || !mode || saving) return;
    let req: Promise<unknown>;
    if (mode === "signout" && signoutDest === "truck") {
      // "Take Out -> My Truck" is a stock relocation, not a job cost.
      req = api("/transactions/transfer", {
        method: "POST",
        body: { item_id: item.id, qty, from_location_id: sourceId, to_location_id: destId },
      });
    } else if (mode === "signout") {
      req = api("/transactions/sign-out", {
        method: "POST",
        body: { item_id: item.id, qty, from_location_id: sourceId, job_id: job!.id },
      });
    } else if (mode === "return") {
      req = api("/transactions/return", {
        method: "POST",
        body: { item_id: item.id, qty, to_location_id: destId, job_id: job!.id },
      });
    } else {
      req = api("/transactions/transfer", {
        method: "POST",
        body: { item_id: item.id, qty, from_location_id: transferFromId, to_location_id: destId },
      });
    }
    const finishedMode = mode;
    const finishedToTruck = signoutDest === "truck";
    setSaving(true);
    try {
      await req;
      setSaving(false);
      setStep("success");
      setTimeout(() => {
        close();
        if (finishedMode === "signout" && !finishedToTruck) navigate("/search");
        else load();
      }, 1100);
      load();
    } catch (e) {
      setSaving(false);
      toast(
        "error",
        `${MODE_LABEL[finishedMode]} failed — nothing was recorded. ${e instanceof Error ? e.message : ""}`,
      );
    }
  };

  if (!item) return <PageLoader />;

  const tint = catTint(item.category);

  const locName = (locId: number | null) => locations.find((l) => l.id === locId)?.name ?? "—";

  /** Unit shown as a small suffix next to the big stock number. */
  const unitSuffix = (q: string | undefined) => {
    const n = q ? parseFloat(q) : 0;
    if (item.unit === "foot") return "ft";
    if (item.unit === "box") return n === 1 ? "box" : "boxes";
    return "ea";
  };

  const StockCard = ({ icon, label, qty }: { icon: string; label: string; qty: string | undefined }) => (
    <div className="card p-4">
      <div className="flex items-center gap-1.5">
        <Icon name={icon} size={14} className="text-slate-400 dark:text-slate-500" />
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {label}
        </span>
      </div>
      <p className="stat-number mt-1 text-[30px] leading-tight">
        {qty ? fmtQty(qty) : 0}
        <span className="ml-1.5 text-[13px] font-semibold text-slate-400 dark:text-slate-500">
          {unitSuffix(qty)}
        </span>
      </p>
      <p className="mt-0.5 text-[12px] text-slate-400 dark:text-slate-500">
        of {stock ? fmtQty(stock.total) : "0"} total on hand
      </p>
    </div>
  );

  const LocationChoice = ({
    value,
    onPick,
    exclude,
    compact = false,
  }: {
    value: number | null;
    onPick: (id: number) => void;
    exclude?: number | null;
    compact?: boolean;
  }) => {
    const visible = compact && !showAllLocations
      ? locations.filter(
          (l) => l.type === "shop" || l.id === myTruck?.location_id || l.id === value,
        )
      : locations;
    return (
    <div className="space-y-2">
      {visible
        .filter((l) => l.id !== exclude)
        .map((l) => {
          const row = stock?.locations.find((s) => s.location_id === l.id);
          const isMine = l.id === myTruck?.location_id;
          const isShop = l.type === "shop";
          const selected = value === l.id;
          return (
            <button
              key={l.id}
              onClick={() => onPick(l.id)}
              className={`card-interactive flex w-full items-center gap-3 p-3 ${
                selected ? "border-brand-500 ring-2 ring-brand-500/20 dark:border-brand-500" : ""
              }`}
            >
              <span
                className={`icon-disc ${
                  isShop
                    ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                    : "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"
                }`}
              >
                <Icon name={isShop ? "store" : "truck"} size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">{l.name}</span>
                  {isMine && (
                    <span className="badge bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                      Mine
                    </span>
                  )}
                </span>
                <span className="block text-[13px] text-slate-400 dark:text-slate-500">
                  {row ? fmtQty(row.qty, item.unit) : "0"} on hand
                </span>
              </span>
              {selected && (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
                  <Icon name="check" size={15} strokeWidth={2.5} />
                </span>
              )}
            </button>
          );
        })}
      {compact && !showAllLocations && (
        <button
          className="btn-ghost min-h-[48px] w-full text-sm"
          onClick={() => setShowAllLocations(true)}
        >
          Other location…
          <Icon name="chevron-down" size={16} />
        </button>
      )}
    </div>
    );
  };

  return (
    <div className="space-y-5 animate-fade-up">
      <button onClick={() => navigate(-1)} className="btn-ghost -ml-3 min-h-[48px]">
        <Icon name="arrow-left" size={18} />
        Back
      </button>

      <div className="flex items-start gap-4">
        <ItemThumb item={item} size={56} />
        <div className="min-w-0 flex-1">
          <span className={`badge ${tint.badge}`}>{item.category}</span>
          <h1 className="mt-1.5 text-[24px] font-bold leading-tight tracking-tight">{item.name}</h1>
          <p className="mt-1 text-[13px] text-slate-400 dark:text-slate-500">
            {item.sku}
            {item.description ? ` · ${item.description}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StockCard icon="store" label="Shop" qty={shopRow?.qty} />
        {allTrucks.map((truck, i) => (
          <StockCard
            key={truck?.id ?? `truck-${i}`}
            icon="truck"
            label={truck?.name ?? `Truck ${i + 1}`}
            qty={truck ? stock?.locations.find((l) => l.location_id === truck.id)?.qty : undefined}
          />
        ))}
      </div>

      <div className="space-y-2.5">
        <button
          onClick={() => {
            begin("signout");
            if (hasTruckStock) setStep("route");
          }}
          className="btn-primary min-h-[58px] w-full text-[17px]"
        >
          Take Out
          <Icon name="arrow-right" size={20} />
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={() => begin("return")} className="btn-secondary">
            <Icon name="refresh" size={18} />
            Return
          </button>
          <button onClick={() => begin("transfer")} className="btn-secondary">
            <Icon name="arrow-swap" size={18} />
            Transfer
          </button>
        </div>
        <button onClick={() => setCartOpen(true)} className="btn-ghost min-h-[48px] w-full">
          <Icon name="cart" size={18} />
          Add to Cart
        </button>
      </div>

      {mode && step !== "success" && (
        <Sheet title={`${MODE_LABEL[mode]}: ${item.name}`} onClose={close}>
          {step === "qty" && (
            <QtyPad
              unit={item.unit}
              quickAdvance={mode !== "transfer"}
              onConfirm={(q) => {
                setQty(q);
                if (mode === "transfer") {
                  setTransferFromId(shopLoc?.id ?? null);
                  setDestId(myTruck?.location_id ?? null);
                  setStep("location");
                } else if (mode === "signout" && signoutDest === "job") {
                  // route step already fixed "-> a job" (from either Stock or Truck)
                  setStep("job");
                } else if (mode === "signout") {
                  // either "Stock -> Truck" was picked, or there was no truck
                  // stock at all and we skipped straight here -- either way,
                  // the only thing left to resolve is which truck / whether
                  // a job instead.
                  setStep("destination");
                } else {
                  setStep("job");
                }
              }}
            />
          )}

          {step === "route" && mode === "signout" && (
            <div className="space-y-2.5">
              <button
                onClick={() => {
                  setSignoutDest("truck");
                  setSourceId(shopLoc?.id ?? null);
                  setDestId(null);
                  setStep("qty");
                }}
                className="card-interactive flex w-full items-center gap-3.5 p-4 text-left"
              >
                <span className="icon-disc bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                  <Icon name="truck" size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">Stock → Truck</span>
                  <span className="block text-[13px] text-slate-400 dark:text-slate-500">
                    Load material from the shop onto a truck
                  </span>
                </span>
                <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
              </button>
              <button
                onClick={() => {
                  setSignoutDest("job");
                  setDestId(null);
                  if (trucksWithStock.length === 1) {
                    setSourceId(trucksWithStock[0].id);
                    setStep("qty");
                  } else {
                    setSourceId(null);
                    setStep("route-truck");
                  }
                }}
                className="card-interactive flex w-full items-center gap-3.5 p-4 text-left"
              >
                <span className="icon-disc bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                  <Icon name="briefcase" size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">Truck → Job</span>
                  <span className="block text-[13px] text-slate-400 dark:text-slate-500">
                    Take material already on a truck to a job site
                  </span>
                </span>
                <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
              </button>
              <button
                onClick={() => {
                  setSignoutDest("job");
                  setSourceId(shopLoc?.id ?? null);
                  setDestId(null);
                  setStep("qty");
                }}
                className="card-interactive flex w-full items-center gap-3.5 p-4 text-left"
              >
                <span className="icon-disc bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                  <Icon name="briefcase" size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">Stock → Job</span>
                  <span className="block text-[13px] text-slate-400 dark:text-slate-500">
                    Sign it out from the shop straight to a job site
                  </span>
                </span>
                <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
              </button>
            </div>
          )}

          {step === "route-truck" && mode === "signout" && (
            <div className="space-y-2.5">
              <p className="px-1 text-[13px] text-slate-400 dark:text-slate-500">
                More than one truck has some on hand — which one is this coming off of?
              </p>
              {trucksWithStock.map((truck) => (
                <button
                  key={truck.id}
                  onClick={() => {
                    setSourceId(truck.id);
                    setStep("qty");
                  }}
                  className="card-interactive flex w-full items-center gap-3.5 p-4 text-left"
                >
                  <span className="icon-disc bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                    <Icon name="truck" size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold">{truck.name}</span>
                    <span className="block text-[13px] text-slate-400 dark:text-slate-500">
                      {fmtQty(stock?.locations.find((l) => l.location_id === truck.id)?.qty ?? "0", item.unit)} on hand
                    </span>
                  </span>
                  <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
                </button>
              ))}
            </div>
          )}

          {step === "destination" && mode === "signout" && (
            <div className="space-y-2.5">
              {allTrucks.map((truck, i) =>
                truck ? (
                  <button
                    key={truck.id}
                    onClick={() => {
                      setSignoutDest("truck");
                      setSourceId(shopLoc?.id ?? defaultSource(qty));
                      setDestId(truck.id);
                      setStep("confirm");
                    }}
                    className="card-interactive flex w-full items-center gap-3.5 p-4 text-left"
                  >
                    <span className="icon-disc bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                      <Icon name="truck" size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16px] font-semibold">{truck.name}</span>
                      <span className="block text-[13px] text-slate-400 dark:text-slate-500">
                        Load it onto {truck.name}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
                  </button>
                ) : (
                  <div key={i} className="card p-4 text-[13px] text-slate-400 dark:text-slate-500">
                    Truck {i + 1} isn't set up yet — ask an admin to add it in Settings.
                  </div>
                ),
              )}
              {signoutDest !== "truck" && (
                <button
                  onClick={() => {
                    setSignoutDest("job");
                    setStep("job");
                  }}
                  className="card-interactive flex w-full items-center gap-3.5 p-4 text-left"
                >
                  <span className="icon-disc bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                    <Icon name="briefcase" size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold">A Job</span>
                    <span className="block text-[13px] text-slate-400 dark:text-slate-500">
                      Sign it out straight to a job site
                    </span>
                  </span>
                  <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
                </button>
              )}
            </div>
          )}

          {step === "job" && (
            <JobPicker
              onPick={(j) => {
                setJob(j);
                // source/destination defaults are pre-picked so the next tap can be Confirm
                // (unless the route step already fixed the source -- e.g. "Truck -> Job")
                if (mode === "signout" && sourceId === null) setSourceId(defaultSource(qty));
                else if (mode !== "signout") setDestId(shopLoc?.id ?? null);
                setStep("confirm");
              }}
            />
          )}

          {step === "location" && mode === "transfer" && (
            <div className="space-y-4">
              <div>
                <p className="section-title">From</p>
                <LocationChoice value={transferFromId} onPick={setTransferFromId} exclude={destId} />
              </div>
              <div>
                <p className="section-title">To</p>
                <LocationChoice value={destId} onPick={setDestId} exclude={transferFromId} />
              </div>
              <button
                className="btn-primary min-h-[56px] w-full text-[17px]"
                disabled={transferFromId === null || destId === null}
                onClick={() => setStep("confirm")}
              >
                Next
                <Icon name="arrow-right" size={18} />
              </button>
            </div>
          )}

          {step === "confirm" && (
            <div className="space-y-4">
              <div className="card space-y-2 py-5 text-center">
                <p className="stat-number text-[34px] leading-none">
                  {fmtQty(qty, item.unit)}
                </p>
                <p className="text-[15px] font-semibold">{item.name}</p>
                <div className="flex items-center justify-center gap-2 pt-1">
                  {mode === "signout" && signoutDest === "truck" && (
                    <>
                      <RouteChip>{locName(sourceId)}</RouteChip>
                      <Icon name="arrow-right" size={16} className="text-slate-400 dark:text-slate-500" />
                      <RouteChip>{locName(destId)}</RouteChip>
                    </>
                  )}
                  {mode === "signout" && signoutDest === "job" && (
                    <>
                      <RouteChip>{locName(sourceId)}</RouteChip>
                      <Icon name="arrow-right" size={16} className="text-slate-400 dark:text-slate-500" />
                      <RouteChip>
                        {job?.job_number} {job?.name}
                      </RouteChip>
                    </>
                  )}
                  {mode === "return" && (
                    <>
                      <RouteChip>{job?.job_number}</RouteChip>
                      <Icon name="arrow-right" size={16} className="text-slate-400 dark:text-slate-500" />
                      <RouteChip>{locName(destId)}</RouteChip>
                    </>
                  )}
                  {mode === "transfer" && (
                    <>
                      <RouteChip>{locName(transferFromId)}</RouteChip>
                      <Icon name="arrow-right" size={16} className="text-slate-400 dark:text-slate-500" />
                      <RouteChip>{locName(destId)}</RouteChip>
                    </>
                  )}
                </div>
              </div>

              {/* inline source/destination switch — no extra screen, default pre-picked */}
              {mode === "signout" && (
                <div>
                  <p className="section-title">Take from</p>
                  <LocationChoice
                    value={sourceId}
                    onPick={setSourceId}
                    exclude={signoutDest === "truck" ? destId : undefined}
                    compact
                  />
                </div>
              )}
              {mode === "return" && (
                <div>
                  <p className="section-title">Return to</p>
                  <LocationChoice value={destId} onPick={setDestId} compact />
                </div>
              )}

              <button
                onClick={doConfirm}
                disabled={
                  saving ||
                  (mode === "signout" ? sourceId === null : mode === "return" ? destId === null : false)
                }
                className="btn-primary min-h-[64px] w-full text-[19px]"
              >
                {saving ? <Spinner /> : null}
                Confirm {MODE_LABEL[mode]}
              </button>
            </div>
          )}
        </Sheet>
      )}

      {mode && step === "success" && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white animate-fade-in dark:bg-slate-950">
          <SuccessCheck />
          <p className="mt-6 text-[22px] font-bold tracking-tight">
            {mode === "signout" && signoutDest === "truck"
              ? "Loaded onto truck"
              : mode === "signout"
                ? "Signed out"
                : mode === "return"
                  ? "Returned"
                  : "Transferred"}
          </p>
          <p className="mt-1 text-[15px] text-slate-400 dark:text-slate-500">
            {fmtQty(qty, item.unit)} · {item.name}
          </p>
          <div className="mt-4 flex max-w-[90%] items-center justify-center gap-2">
            {mode === "signout" && signoutDest === "truck" && (
              <>
                <RouteChip>{locName(sourceId)}</RouteChip>
                <Icon name="arrow-right" size={16} className="text-slate-400 dark:text-slate-500" />
                <RouteChip>{locName(destId)}</RouteChip>
              </>
            )}
            {mode === "signout" && signoutDest === "job" && (
              <>
                <RouteChip>{locName(sourceId)}</RouteChip>
                <Icon name="arrow-right" size={16} className="text-slate-400 dark:text-slate-500" />
                <RouteChip>
                  {job?.job_number} {job?.name}
                </RouteChip>
              </>
            )}
            {mode === "return" && (
              <>
                <RouteChip>{job?.job_number}</RouteChip>
                <Icon name="arrow-right" size={16} className="text-slate-400 dark:text-slate-500" />
                <RouteChip>{locName(destId)}</RouteChip>
              </>
            )}
            {mode === "transfer" && (
              <>
                <RouteChip>{locName(transferFromId)}</RouteChip>
                <Icon name="arrow-right" size={16} className="text-slate-400 dark:text-slate-500" />
                <RouteChip>{locName(destId)}</RouteChip>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      {cartOpen && (
        <Sheet title={`Add to cart: ${item.name}`} onClose={() => setCartOpen(false)}>
          <QtyPad
            unit={item.unit}
            confirmLabel="Add to cart"
            onConfirm={(q) => {
              cart.add(item, q);
              toast("success", "Added to cart");
              setCartOpen(false);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
