import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../../api";
import { useAuth } from "../../auth";
import { useCart } from "../../cart";
import { useClock } from "../../clock";
import Icon from "../../components/Icon";
import JobPicker from "../../components/JobPicker";
import Sheet from "../../components/Sheet";
import TxnList from "../../components/TxnList";
import { Empty, ItemThumb, ListSkeleton, Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import type { Item, Job, StockRow, TechDashboard } from "../../types";

const IN_STOCK_PREVIEW = 8;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export default function Home() {
  const { user } = useAuth();
  const { lines } = useCart();
  const {
    clockedIn,
    clockInAt,
    jobNumber,
    jobName,
    loading: clockLoading,
    clockIn,
    clockOut,
    giveGpsConsent,
  } = useClock();
  const toast = useToast();
  const navigate = useNavigate();
  const [dash, setDash] = useState<TechDashboard | null>(null);
  const [inStock, setInStock] = useState<Item[] | null>(null);
  const [truckStock, setTruckStock] = useState<StockRow[] | null>(null);
  const [clockBusy, setClockBusy] = useState(false);
  const [elapsed, setElapsed] = useState("0:00:00");
  const [jobPickerOpen, setJobPickerOpen] = useState(false);

  // Big ticking clock -- recomputed every second from clockInAt while on shift.
  useEffect(() => {
    if (!clockedIn || !clockInAt) return;
    const tick = () => {
      const totalSec = Math.max(0, Math.floor((Date.now() - new Date(clockInAt).getTime()) / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setElapsed(`${h}:${pad2(m)}:${pad2(s)}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [clockedIn, clockInAt]);

  const handleClockOut = async () => {
    setClockBusy(true);
    try {
      await clockOut();
      toast("success", "Clocked out");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't clock out");
    } finally {
      setClockBusy(false);
    }
  };

  const handlePickJobAndClockIn = async (job: Job) => {
    setJobPickerOpen(false);
    setClockBusy(true);
    try {
      // Tapping Clock In is the agreement itself -- recorded once,
      // permanently, the first time; harmless to send again after that.
      await giveGpsConsent();
      await clockIn(job.id);
      toast("success", `Clocked in to ${job.job_number}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't clock in");
    } finally {
      setClockBusy(false);
    }
  };

  useEffect(() => {
    api<TechDashboard>("/dashboard/tech").then(setDash).catch(() => {});
  }, []);

  useEffect(() => {
    api<Item[]>("/items?in_stock=true").then(setInStock).catch(() => {});
  }, []);

  useEffect(() => {
    api<StockRow[]>("/stock").then(setTruckStock).catch(() => {});
  }, []);

  const firstName = user?.name?.split(/\s+/)[0] ?? "there";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const truckCount =
    truckStock === null
      ? null
      : new Set(truckStock.filter((r) => r.location_name !== "Shop").map((r) => r.item_id)).size;

  return (
    <div className="space-y-5 animate-fade-up">
      <header>
        <p className="page-eyebrow">{today}</p>
        <h1 className="page-title mt-1">Hey {firstName}</h1>
      </header>

      {!clockLoading && (
        <div className={`card p-4 ${clockedIn ? "border-emerald-500/40 bg-emerald-500/5" : ""}`}>
          {clockedIn ? (
            <div className="space-y-3 text-center">
              <div>
                <p className="text-[13.5px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Clocked in
                </p>
                {jobNumber && (
                  <p className="truncate text-[13px] font-medium">
                    {jobNumber}
                    {jobName ? ` — ${jobName}` : ""}
                  </p>
                )}
                <p className="text-[12px] text-slate-500 dark:text-slate-400">
                  Since{" "}
                  {clockInAt &&
                    new Date(clockInAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                </p>
              </div>
              <p className="font-display text-[42px] font-extrabold leading-none tabular-nums tracking-tight">
                {elapsed}
              </p>
              <button
                type="button"
                disabled={clockBusy}
                onClick={handleClockOut}
                className="btn-secondary w-full"
              >
                {clockBusy ? <Spinner /> : <Icon name="logout" size={16} />}
                Clock Out
              </button>
              <button
                type="button"
                onClick={() => navigate("/my-hours")}
                className="text-[12px] font-semibold text-slate-400 underline-offset-2 hover:underline dark:text-slate-500"
              >
                View my hours
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div>
                <p className="text-[13.5px] font-semibold">Not clocked in</p>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">
                  Tap in for the day when you start working
                </p>
              </div>
              <button
                type="button"
                disabled={clockBusy}
                onClick={() => setJobPickerOpen(true)}
                className="btn-primary w-full"
              >
                {clockBusy ? <Spinner /> : <Icon name="clock" size={16} />}
                Clock In
              </button>
              <p className="text-center text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                By tapping Clock In, you agree to GPS location tracking while you're clocked in.
              </p>
            </div>
          )}
        </div>
      )}

      {jobPickerOpen && (
        <Sheet title="Clock in to…" onClose={() => setJobPickerOpen(false)}>
          <JobPicker onPick={handlePickJobAndClockIn} />
        </Sheet>
      )}

      {/* THE hero — Find is the app's front door */}
      <button
        onClick={() => navigate("/search")}
        className="hero-card flex min-h-[120px] w-full select-none items-center p-5 text-left transition-all duration-150 active:scale-[0.98] active:brightness-95"
      >
        <span className="relative z-10 flex w-full items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <Icon name="search" size={28} strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[21px] font-extrabold tracking-tight">
              Find material
            </span>
            <span className="mt-0.5 block text-[13px] font-medium leading-snug text-white/75">
              Search the shop and your truck, sign out in seconds
            </span>
          </span>
          <Icon name="chevron-right" size={20} className="text-white/60" />
        </span>
      </button>

      <section>
        <h2 className="section-title">
          <Icon name="package" size={14} />
          In stock now
        </h2>
        {inStock === null ? (
          <ListSkeleton rows={3} />
        ) : inStock.length === 0 ? (
          <Empty icon="package" title="Nothing in stock" hint="Nothing is on hand at the shop or on a truck right now." />
        ) : (
          <div className="space-y-2.5">
            {inStock.slice(0, IN_STOCK_PREVIEW).map((i) => {
              return (
                <button
                  key={i.id}
                  onClick={() => navigate(`/item/${i.id}`)}
                  className="card-interactive flex w-full items-center gap-3 p-3.5"
                >
                  <ItemThumb item={i} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{i.name}</span>
                    <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">
                      {i.sku} · {i.category}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
                </button>
              );
            })}
            {inStock.length > IN_STOCK_PREVIEW && (
              <button className="btn-secondary min-h-[48px] w-full" onClick={() => navigate("/search")}>
                See all {inStock.length} in stock
                <Icon name="arrow-right" size={16} />
              </button>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => navigate("/truck")}
          className="tile-blue flex min-h-[116px] select-none flex-col justify-between text-left transition-all duration-150 active:scale-[0.98] active:brightness-95"
        >
          <span className="relative z-10 flex w-full items-start justify-between gap-2">
            <span className="tile-caption pt-1">Trucks</span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <Icon name="truck" size={18} />
            </span>
          </span>
          <span className="relative z-10 flex items-baseline gap-1.5">
            <span className="stat-number text-[28px] leading-none">{truckCount ?? "—"}</span>
            <span className="text-[12px] font-semibold text-white/70">
              item{truckCount === 1 ? "" : "s"}
            </span>
          </span>
          <span className="tile-fab">
            <Icon name="arrow-right" size={15} />
          </span>
        </button>

        <button
          onClick={() => navigate("/cart")}
          className="tile-purple flex min-h-[116px] select-none flex-col justify-between text-left transition-all duration-150 active:scale-[0.98] active:brightness-95"
        >
          <span className="relative z-10 flex w-full items-start justify-between gap-2">
            <span className="tile-caption pt-1">Cart</span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <Icon name="cart" size={18} />
            </span>
          </span>
          <span className="relative z-10 flex items-baseline gap-1.5">
            <span className="stat-number text-[28px] leading-none">{lines.length}</span>
            <span className="text-[12px] font-semibold text-white/70">
              line{lines.length === 1 ? "" : "s"}
            </span>
          </span>
          <span className="tile-fab">
            <Icon name="arrow-right" size={15} />
          </span>
        </button>
      </div>

      <section>
        <h2 className="section-title">
          <Icon name="history" size={14} />
          Recent activity
        </h2>
        {dash === null ? <ListSkeleton rows={4} /> : <TxnList txns={dash.my_transactions} />}
      </section>
    </div>
  );
}
