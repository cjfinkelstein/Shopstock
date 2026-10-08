import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, apiUpload } from "../../api";
import { useAuth } from "../../auth";
import { isAssignee } from "../../calendarAssignees";
import { useCart } from "../../cart";
import { isConnectivityError, useClock } from "../../clock";
import { enqueueAction } from "../../offlineQueue";
import AuthedImage from "../../components/AuthedImage";
import Icon from "../../components/Icon";
import JobPicker from "../../components/JobPicker";
import Sheet from "../../components/Sheet";
import TxnList from "../../components/TxnList";
import { ListSkeleton, Spinner } from "../../components/ui";
import { useToast } from "../../toast";
import TeamCalendar from "../TeamCalendar";
import type { CalendarEvent, ClockOutPhoto, Job, StockRow, TechDashboard } from "../../types";

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
    approvalStatus,
    gpsConsentGiven,
    offlinePending,
    loading: clockLoading,
    clockIn,
    clockOut,
    giveGpsConsent,
  } = useClock();
  const toast = useToast();
  const navigate = useNavigate();
  const [dash, setDash] = useState<TechDashboard | null>(null);
  const [truckStock, setTruckStock] = useState<StockRow[] | null>(null);
  const [clockBusy, setClockBusy] = useState(false);
  const [elapsed, setElapsed] = useState("0:00:00");
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [clockOutNoteOpen, setClockOutNoteOpen] = useState(false);
  const [clockOutNote, setClockOutNote] = useState("");
  const [todaysTasks, setTodaysTasks] = useState<CalendarEvent[] | null>(null);
  const [togglingTaskId, setTogglingTaskId] = useState<number | null>(null);
  const [clockOutPhotos, setClockOutPhotos] = useState<ClockOutPhoto[]>([]);
  const [pendingPhoto, setPendingPhoto] = useState<{ file: File; previewUrl: string } | null>(null);
  const [pendingCaption, setPendingCaption] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

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
      await clockOut(clockOutNote.trim());
      toast("success", "Clocked out");
      setClockOutNoteOpen(false);
      setClockOutNote("");
      setTodaysTasks(null);
      setClockOutPhotos([]);
      discardPendingPhoto();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't clock out");
    } finally {
      setClockBusy(false);
    }
  };

  // Only Adam/Ed/Avigdor can ever have an assigned task (see
  // calendarAssignees.ts); anyone else never bothers fetching.
  useEffect(() => {
    if (!clockOutNoteOpen || !isAssignee(user?.name)) return;
    const today = toISODate(new Date());
    api<CalendarEvent[]>(`/calendar?date_from=${today}&date_to=${today}`)
      .then((events) => {
        const firstName = user?.name.trim().split(/\s+/)[0]?.toLowerCase();
        setTodaysTasks(events.filter((e) => e.assignee?.toLowerCase() === firstName));
      })
      .catch(() => setTodaysTasks(null));
  }, [clockOutNoteOpen, user?.name]);

  const toggleTask = async (task: CalendarEvent) => {
    setTogglingTaskId(task.id);
    try {
      const updated = await api<CalendarEvent>(`/calendar/${task.id}`, {
        method: "PATCH",
        body: { done: !task.done },
      });
      setTodaysTasks((prev) => (prev ?? []).map((t) => (t.id === updated.id ? updated : t)));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't update");
    } finally {
      setTogglingTaskId(null);
    }
  };

  const discardPendingPhoto = () => {
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl);
    setPendingPhoto(null);
    setPendingCaption("");
  };

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    discardPendingPhoto();
    setPendingPhoto({ file, previewUrl: URL.createObjectURL(file) });
  };

  // Uploads right away (not queued offline -- a multipart upload is a much
  // bigger thing to replay reliably than clock in/out's small JSON body;
  // this just fails with a clear error if there's no signal, same as any
  // other action that genuinely needs connectivity).
  const uploadPendingPhoto = async () => {
    if (!pendingPhoto) return;
    setUploadingPhoto(true);
    try {
      const form = new FormData();
      form.append("file", pendingPhoto.file);
      if (pendingCaption.trim()) form.append("caption", pendingCaption.trim());
      const photo = await apiUpload<ClockOutPhoto>("/time/clock-out/photos", form);
      setClockOutPhotos((prev) => [...prev, photo]);
      discardPendingPhoto();
      if (photoInputRef.current) photoInputRef.current.value = "";
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't upload photo");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePickJobAndClockIn = async (job: Job) => {
    setJobPickerOpen(false);
    setClockBusy(true);
    try {
      // Tapping Clock In is the agreement itself -- recorded once,
      // permanently, the first time; harmless to send again after that.
      // Skipped once already given so a tech with no signal isn't blocked
      // by a consent call that has nothing new to record anyway. A tech's
      // very FIRST clock-in with no signal at all still needs this
      // recorded -- the server rejects clock-in without it -- so a pure
      // connectivity failure here queues it instead of dropping it; it
      // replays ahead of the clock-in queued right after it (same
      // oldest-first queue), so the consent is in place by the time the
      // clock-in itself replays.
      if (!gpsConsentGiven) {
        try {
          await giveGpsConsent();
        } catch (e) {
          if (!isConnectivityError(e)) throw e;
          await enqueueAction("gps_consent", {});
        }
      }
      await clockIn(job);
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
                <div className="flex items-center justify-center gap-1.5">
                  <p className="text-[13.5px] font-semibold text-emerald-700 dark:text-emerald-400">
                    Clocked in
                  </p>
                  {approvalStatus === "pending" ? (
                    <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      Pending approval
                    </span>
                  ) : (
                    <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      Approved
                    </span>
                  )}
                </div>
                {offlinePending && (
                  <p className="mt-1 flex items-center justify-center gap-1 text-[11.5px] font-semibold text-orange-600 dark:text-orange-400">
                    <Icon name="refresh" size={12} />
                    No signal — will sync automatically
                  </p>
                )}
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
                onClick={() => setClockOutNoteOpen(true)}
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
                {offlinePending && (
                  <p className="mt-1 flex items-center justify-center gap-1 text-[11.5px] font-semibold text-orange-600 dark:text-orange-400">
                    <Icon name="refresh" size={12} />
                    No signal — your last clock action will sync automatically
                  </p>
                )}
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
          <JobPicker onPick={handlePickJobAndClockIn} allowCreate />
        </Sheet>
      )}

      {clockOutNoteOpen && (
        <Sheet
          title="What did you do today?"
          subtitle="Optional — only your admin can see this"
          onClose={() => {
            if (clockBusy) return;
            setClockOutNoteOpen(false);
            setTodaysTasks(null);
            setClockOutPhotos([]);
            discardPendingPhoto();
          }}
        >
          <div className="space-y-4">
            {todaysTasks && todaysTasks.length > 0 && (
              <div>
                <p className="label mb-1.5">Today's tasks — check off what you finished</p>
                <ul className="space-y-1.5 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                  {todaysTasks.map((t) => (
                    <li key={t.id} className="flex items-start gap-2">
                      <button
                        type="button"
                        aria-label={t.done ? "Mark not done" : "Mark done"}
                        disabled={togglingTaskId === t.id}
                        onClick={() => toggleTask(t)}
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          t.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-slate-600"
                        }`}
                      >
                        {t.done && <Icon name="check" size={12} strokeWidth={3} />}
                      </button>
                      <span className={`text-[14px] ${t.done ? "text-slate-400 line-through" : ""}`}>{t.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <textarea
              className="input min-h-[120px]"
              placeholder="e.g. Ran conduit for the panel upgrade, picked up permit from the county office…"
              autoFocus
              value={clockOutNote}
              onChange={(e) => setClockOutNote(e.target.value)}
            />

            <div>
              <p className="label mb-1.5">Photos (optional)</p>
              {clockOutPhotos.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {clockOutPhotos.map((p) => (
                    <div key={p.id} className="w-16">
                      <AuthedImage src={p.url} alt={p.caption ?? "Photo"} className="h-16 w-16 rounded-lg object-cover" />
                      {p.caption && <p className="mt-0.5 truncate text-[10px] text-slate-400">{p.caption}</p>}
                    </div>
                  ))}
                </div>
              )}

              {pendingPhoto ? (
                <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                  <img src={pendingPhoto.previewUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <input
                      className="input"
                      placeholder="What's this a photo of? (optional)"
                      value={pendingCaption}
                      onChange={(e) => setPendingCaption(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={uploadingPhoto}
                        onClick={uploadPendingPhoto}
                        className="btn-secondary !min-h-0 flex-1 py-1.5 text-[13px]"
                      >
                        {uploadingPhoto ? <Spinner /> : "Add photo"}
                      </button>
                      <button
                        type="button"
                        disabled={uploadingPhoto}
                        onClick={discardPendingPhoto}
                        className="btn-ghost !min-h-0 px-3 py-1.5 text-[13px]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="btn-secondary w-full"
                >
                  <Icon name="camera" size={16} />
                  Add a photo
                </button>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => choosePhoto(e.target.files?.[0])}
              />
            </div>

            <button
              type="button"
              disabled={clockBusy}
              onClick={handleClockOut}
              className="btn-primary w-full"
            >
              {clockBusy ? <Spinner /> : <Icon name="logout" size={16} />}
              Clock Out
            </button>
          </div>
        </Sheet>
      )}

      <TeamCalendar embedded />

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
