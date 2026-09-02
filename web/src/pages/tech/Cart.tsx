import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, fmtQty } from "../../api";
import { useAuth } from "../../auth";
import { useCart } from "../../cart";
import Icon from "../../components/Icon";
import JobPicker from "../../components/JobPicker";
import QtyPad from "../../components/QtyPad";
import Sheet from "../../components/Sheet";
import { Empty, ItemThumb, Spinner, SuccessCheck } from "../../components/ui";
import { useToast } from "../../toast";
import type { CartLine, Job, Location, StockRow, Txn } from "../../types";

export default function Cart() {
  const cart = useCart();
  const { myTruck } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [editLine, setEditLine] = useState<CartLine | null>(null);
  const [jobPick, setJobPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [shopId, setShopId] = useState<number | null>(null);

  useEffect(() => {
    api<Location[]>("/locations")
      .then((ls) => setShopId(ls.find((l) => l.type === "shop")?.id ?? null))
      .catch(() => {});
  }, []);

  /** Per-line default source: My Truck when it holds >= qty, else Shop —
   * the same rule as single-item sign-out. */
  const resolveSources = async (): Promise<Map<number, number>> => {
    const sources = new Map<number, number>();
    let truckStock: StockRow[] = [];
    if (myTruck) {
      truckStock = await api<StockRow[]>(`/stock?location_id=${myTruck.location_id}`);
    }
    const truckQty = new Map(truckStock.map((r) => [r.item_id, parseFloat(r.qty)]));
    for (const l of cart.lines) {
      if (l.from_location_id) {
        sources.set(l.item.id, l.from_location_id);
      } else if (myTruck && (truckQty.get(l.item.id) ?? 0) >= parseFloat(l.qty)) {
        sources.set(l.item.id, myTruck.location_id);
      } else if (shopId) {
        sources.set(l.item.id, shopId);
      }
    }
    return sources;
  };

  const checkoutToJob = async (job: Job) => {
    setJobPick(false);
    setBusy(true);
    try {
      const sources = await resolveSources();
      const res = await api<Txn[]>("/transactions/sign-out/batch", {
        method: "POST",
        body: {
          job_id: job.id,
          from_location_id: shopId,
          lines: cart.lines.map((l) => ({
            item_id: l.item.id,
            qty: l.qty,
            from_location_id: sources.get(l.item.id) ?? null,
          })),
        },
      });
      const flagged = res.filter((t) => t.went_negative).length;
      cart.clear();
      setDone(`Signed out ${res.length} item${res.length === 1 ? "" : "s"} to ${job.job_number}`);
      if (flagged) toast("info", `${flagged} item(s) went negative — flagged for recount`);
    } catch (e) {
      toast("error", `Cart sign-out FAILED — nothing was recorded. ${e instanceof Error ? e.message : ""}`);
    } finally {
      setBusy(false);
    }
  };

  const loadTruck = async () => {
    if (!myTruck || !shopId) {
      toast("error", "No truck assigned to you");
      return;
    }
    setBusy(true);
    try {
      const res = await api<Txn[]>("/transactions/transfer/batch", {
        method: "POST",
        body: {
          from_location_id: shopId,
          to_location_id: myTruck.location_id,
          lines: cart.lines.map((l) => ({ item_id: l.item.id, qty: l.qty })),
        },
      });
      cart.clear();
      setDone(`Loaded ${res.length} item${res.length === 1 ? "" : "s"} onto ${myTruck.truck_name}`);
    } catch (e) {
      toast("error", `Truck load FAILED — nothing was recorded. ${e instanceof Error ? e.message : ""}`);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-up">
        <SuccessCheck />
        <p className="mt-6 max-w-[300px] text-[20px] font-bold leading-snug tracking-tight">{done}</p>
        <div className="mt-8 flex gap-3">
          <button
            className="btn-secondary"
            onClick={() => {
              setDone(null);
              navigate("/search?cart=1");
            }}
          >
            <Icon name="plus" size={18} />
            Add more
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              setDone(null);
              navigate("/home");
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const lineCount = cart.lines.length;

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <p className="page-eyebrow">
          Material cart
          {lineCount > 0 ? ` · ${lineCount} line${lineCount === 1 ? "" : "s"}` : ""}
        </p>
        <h1 className="page-title">Cart</h1>
      </div>

      {lineCount === 0 ? (
        <Empty
          icon="cart"
          title="Cart is empty"
          hint="Find items to sign out a batch or load your truck."
          action={
            <button className="btn-primary" onClick={() => navigate("/search?cart=1")}>
              <Icon name="search" size={18} />
              Add items
            </button>
          }
        />
      ) : (
        <>
          <div className="space-y-2.5">
            {cart.lines.map((l) => {
              return (
                <div key={l.item.id} className="card flex items-center gap-3 p-3">
                  <ItemThumb item={l.item} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{l.item.name}</div>
                    <div className="truncate text-[13px] text-slate-400 dark:text-slate-500">{l.item.sku}</div>
                  </div>
                  <button
                    onClick={() => setEditLine(l)}
                    className="flex min-h-[48px] min-w-[64px] items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 font-bold tabular-nums transition-colors active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700"
                    aria-label={`Edit quantity: ${l.item.name}`}
                  >
                    <span className="text-[16px]">{fmtQty(l.qty, l.item.unit)}</span>
                    <Icon name="pencil" size={13} className="text-slate-400 dark:text-slate-500" />
                  </button>
                  <button
                    onClick={() => cart.remove(l.item.id)}
                    className="icon-btn"
                    aria-label={`Remove ${l.item.name}`}
                  >
                    <Icon name="trash" size={19} />
                  </button>
                </div>
              );
            })}
          </div>

          <button className="btn-secondary min-h-[52px] w-full" onClick={() => navigate("/search?cart=1")}>
            <Icon name="plus" size={18} />
            Add more items
          </button>

          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between rounded-2xl bg-slate-100/70 px-4 py-3 dark:bg-slate-800/60">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                <Icon name="cart" size={15} />
                Ready to check out
              </span>
              <span className="text-[15px] font-bold tabular-nums">
                {lineCount} line{lineCount === 1 ? "" : "s"}
              </span>
            </div>
            <button
              className="btn-primary min-h-[60px] w-full text-[17px]"
              disabled={busy}
              onClick={() => setJobPick(true)}
            >
              {busy ? <Spinner /> : <Icon name="briefcase" size={20} />}
              Sign out all to one job
            </button>
            <button
              className="btn-secondary min-h-[60px] w-full text-[16px]"
              disabled={busy || !myTruck}
              onClick={loadTruck}
            >
              <Icon name="truck" size={20} />
              <span className="truncate">
                Load my truck{myTruck ? ` (shop to ${myTruck.truck_name})` : ""}
              </span>
            </button>
          </div>
        </>
      )}

      {jobPick && (
        <Sheet title="Sign out cart to…" onClose={() => setJobPick(false)}>
          <JobPicker onPick={checkoutToJob} />
        </Sheet>
      )}

      {editLine && (
        <Sheet title={`Qty: ${editLine.item.name}`} onClose={() => setEditLine(null)}>
          <QtyPad
            unit={editLine.item.unit}
            initial={editLine.qty}
            confirmLabel="Update"
            onConfirm={(q) => {
              cart.updateQty(editLine.item.id, q);
              setEditLine(null);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
