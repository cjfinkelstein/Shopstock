import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";

import { api, fmtQty, fmtWhen } from "../../api";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { Avatar, Empty, ItemThumb, ListSkeleton, Spinner } from "../../components/ui";
import { hoursLabel } from "../../hours";
import { useToast } from "../../toast";
import type { CalendarEvent, RoutePoint, ShiftRoute, User, WorkerLive } from "../../types";

// ---------- Live map helpers (pins, clustering, route line) ----------

function pinIcon(count: number) {
  const badge =
    count > 1
      ? `<div style="position:absolute;top:-6px;right:-7px;min-width:18px;height:18px;padding:0 4px;
          border-radius:9999px;background:#ef4444;color:#fff;font:700 11px/18px system-ui,sans-serif;
          text-align:center;border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.25)">${count}</div>`
      : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:30px;height:30px;">
      <div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
        background:#0ea5e9;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>
      ${badge}
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

function clusterWorkers(workers: WorkerLive[]) {
  const clusters = new Map<string, { lat: number; lng: number; members: WorkerLive[] }>();
  for (const w of workers) {
    const key = `${w.lat!.toFixed(4)},${w.lng!.toFixed(4)}`;
    const c = clusters.get(key);
    if (c) c.members.push(w);
    else clusters.set(key, { lat: w.lat!, lng: w.lng!, members: [w] });
  }
  return [...clusters.values()];
}

function FitToRoute({ points }: { points: RoutePoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15);
      return;
    }
    map.fitBounds(
      points.map((p) => [p.lat, p.lng] as [number, number]),
      { padding: [30, 30] },
    );
  }, [points, map]);
  return null;
}

const KIND_COLOR: Record<RoutePoint["kind"], string> = {
  clock_in: "#10b981",
  ping: "#0ea5e9",
  clock_out: "#ef4444",
};

function timeAgo(iso: string | null) {
  if (!iso) return "no location yet";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

const REFRESH_MS = 20_000;
const DEFAULT_CENTER: [number, number] = [39.2904, -76.6122]; // Baltimore, MD
const SHIFTS_PER_TECH = 10;

interface Shift {
  id: number;
  clock_in_at: string;
  clock_out_at: string | null;
  still_clocked_in: boolean;
  hours: number;
  job_number: string | null;
  job_name: string | null;
  approval_status: string;
}

interface TechTimesheet {
  user_id: number;
  user_name: string;
  total_hours: number;
  shifts: Shift[];
}

function ApprovalBadge({ status }: { status: string }) {
  return status === "pending" ? (
    <span className="badge shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
      Pending
    </span>
  ) : (
    <span className="badge shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
      Approved
    </span>
  );
}

// ---------- Calendar day-detail types ----------

interface LoginEntry {
  time: string;
  user_name: string;
  role: string;
}

interface DayShiftEntry {
  id: number;
  time: string;
  user_name: string;
  job_number: string | null;
  job_name: string | null;
  clock_out_time: string | null;
  still_clocked_in: boolean;
  hours: number;
  approval_status: string;
  note: string | null;
}

interface SignOutEntry {
  time: string;
  item_name: string;
  sku: string | null;
  image_data?: string | null;
  qty: string;
  unit: string;
  job_name: string | null;
  job_number: string | null;
  user_name: string;
}

interface DayData {
  logins: LoginEntry[];
  shifts: DayShiftEntry[];
  sign_outs: SignOutEntry[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Calendar() {
  const toast = useToast();

  // ---- Live now + all techs (from the old Login Hours page) ----
  const [live, setLive] = useState<WorkerLive[] | null>(null);
  const [techs, setTechs] = useState<User[] | null>(null);
  const [timesheets, setTimesheets] = useState<Record<number, TechTimesheet>>({});
  const [approving, setApproving] = useState<number | null>(null);
  const [routeShiftId, setRouteShiftId] = useState<number | null>(null);
  const [route, setRoute] = useState<ShiftRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const openRoute = async (shiftId: number) => {
    setRouteShiftId(shiftId);
    setRoute(null);
    setRouteLoading(true);
    try {
      const r = await api<ShiftRoute>(`/time/${shiftId}/route`);
      setRoute(r);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't load that shift's route");
      setRouteShiftId(null);
    } finally {
      setRouteLoading(false);
    }
  };

  const setShiftApproval = async (userId: number | null, shiftId: number, approve: boolean) => {
    setApproving(shiftId);
    const nextStatus = approve ? "approved" : "pending";
    try {
      await api(`/time/${shiftId}/${approve ? "approve" : "unapprove"}`, { method: "POST" });
      if (userId != null) {
        setTimesheets((prev) => {
          const sheet = prev[userId];
          if (!sheet) return prev;
          return {
            ...prev,
            [userId]: {
              ...sheet,
              shifts: sheet.shifts.map((s) => (s.id === shiftId ? { ...s, approval_status: nextStatus } : s)),
            },
          };
        });
      }
      setDays((prev) => {
        if (!prev) return prev;
        const next: Record<string, DayData> = {};
        for (const [k, v] of Object.entries(prev)) {
          next[k] = {
            ...v,
            shifts: v.shifts.map((s) => (s.id === shiftId ? { ...s, approval_status: nextStatus } : s)),
          };
        }
        return next;
      });
      toast("success", approve ? "Shift approved" : "Approval undone");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't update this shift");
    } finally {
      setApproving(null);
    }
  };

  useEffect(() => {
    const load = () => api<WorkerLive[]>("/time/live").then(setLive).catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api<User[]>("/users").then((all) => setTechs(all.filter((u) => u.role === "tech"))).catch(() => setTechs([]));
  }, []);

  useEffect(() => {
    api<{ techs: TechTimesheet[] }>("/reports/timesheet")
      .then((r) => {
        const byId: Record<number, TechTimesheet> = {};
        r.techs.forEach((t) => (byId[t.user_id] = t));
        setTimesheets(byId);
      })
      .catch(() => {});
  }, []);

  const located = (live ?? []).filter((w) => w.lat != null && w.lng != null);
  const center: [number, number] = located[0] ? [located[0].lat!, located[0].lng!] : DEFAULT_CENTER;
  const liveById = new Map((live ?? []).map((w) => [w.user_id, w]));
  const liveLoading = live === null || techs === null;

  // ---- Calendar month grid (from the old Calendar page) ----
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [days, setDays] = useState<Record<string, DayData> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const loadDays = useCallback(() => {
    setDays(null);
    const from = toISODate(month);
    const to = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    api<{ days: Record<string, DayData> }>(`/reports/calendar?date_from=${from}&date_to=${to}`)
      .then((r) => setDays(r.days))
      .catch(() => {});
  }, [month]);

  useEffect(loadDays, [loadDays]);

  // ---- Admin-only private notes -- never sent to techs, shown only here ----
  const [adminNotes, setAdminNotes] = useState<Record<string, CalendarEvent[]>>({});
  const [noteExpandedId, setNoteExpandedId] = useState<number | null>(null);
  const [noteEditDraft, setNoteEditDraft] = useState<{ title: string; event_date: string; notes: string } | null>(
    null,
  );
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteText, setNewNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  const loadAdminNotes = useCallback(() => {
    const from = toISODate(month);
    const to = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    api<CalendarEvent[]>(`/calendar/admin?date_from=${from}&date_to=${to}`)
      .then((rows) => {
        const byDate: Record<string, CalendarEvent[]> = {};
        rows.forEach((r) => {
          (byDate[r.event_date] ??= []).push(r);
        });
        setAdminNotes(byDate);
      })
      .catch(() => {});
  }, [month]);

  useEffect(loadAdminNotes, [loadAdminNotes]);

  const closeNoteEditor = () => {
    setNoteExpandedId(null);
    setNoteEditDraft(null);
  };

  const startNoteEdit = (n: CalendarEvent) => {
    setNoteExpandedId(n.id);
    setNoteEditDraft({ title: n.title, event_date: n.event_date, notes: n.notes ?? "" });
  };

  const addNote = async () => {
    if (!selected || !newNoteTitle.trim()) return;
    setNoteSaving(true);
    try {
      const created = await api<CalendarEvent>("/calendar/admin", {
        method: "POST",
        body: { event_date: selected, title: newNoteTitle.trim(), notes: newNoteText.trim() || null },
      });
      setAdminNotes((prev) => ({ ...prev, [selected]: [...(prev[selected] ?? []), created] }));
      setNewNoteTitle("");
      setNewNoteText("");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not add note");
    } finally {
      setNoteSaving(false);
    }
  };

  const toggleNoteDone = async (n: CalendarEvent) => {
    try {
      const updated = await api<CalendarEvent>(`/calendar/admin/${n.id}`, {
        method: "PATCH",
        body: { done: !n.done },
      });
      setAdminNotes((prev) => ({
        ...prev,
        [updated.event_date]: (prev[updated.event_date] ?? []).map((x) => (x.id === updated.id ? updated : x)),
      }));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not update note");
    }
  };

  const saveNoteEdit = async (n: CalendarEvent) => {
    if (!noteEditDraft) return;
    setNoteSaving(true);
    try {
      const updated = await api<CalendarEvent>(`/calendar/admin/${n.id}`, {
        method: "PATCH",
        body: {
          title: noteEditDraft.title.trim(),
          event_date: noteEditDraft.event_date,
          notes: noteEditDraft.notes.trim() || null,
        },
      });
      setAdminNotes((prev) => {
        const next = { ...prev };
        next[n.event_date] = (next[n.event_date] ?? []).filter((x) => x.id !== n.id);
        next[updated.event_date] = [...(next[updated.event_date] ?? []), updated];
        return next;
      });
      closeNoteEditor();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save note");
    } finally {
      setNoteSaving(false);
    }
  };

  const deleteNote = async (n: CalendarEvent) => {
    try {
      await api(`/calendar/admin/${n.id}`, { method: "DELETE" });
      setAdminNotes((prev) => ({
        ...prev,
        [n.event_date]: (prev[n.event_date] ?? []).filter((x) => x.id !== n.id),
      }));
      closeNoteEditor();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not delete note");
    }
  };

  const today = toISODate(new Date());
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const shiftMonth = (delta: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const selectedData = selected && days ? days[selected] : null;
  const selectedTotalHours = selectedData?.shifts.reduce((sum, s) => sum + s.hours, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">Field techs</p>
        <h1 className="page-title">Login Hours</h1>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
          Who's on the clock right now, every tech's history, and a day-by-day calendar of logins, shifts, and
          material signed out.
        </p>
      </div>

      {/* Calendar */}
      <div>
        <div className="mb-2.5 flex flex-wrap items-end justify-between gap-3">
          <p className="section-title flex items-center gap-1.5">
            <Icon name="calendar" size={14} />
            Calendar
          </p>
          <div className="flex items-center gap-2">
            <button className="icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <Icon name="arrow-left" size={18} />
            </button>
            <span className="min-w-[150px] text-center text-[15px] font-bold">{monthLabel}</span>
            <button className="icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
              <Icon name="arrow-right" size={18} />
            </button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            Shifts
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
            Logins
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            Signed out
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
            Personal notes
          </span>
        </div>

        {!days ? (
          <ListSkeleton rows={5} height={90} />
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-800">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500"
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((day, i) => {
                if (day === null)
                  return (
                    <div
                      key={i}
                      className="min-h-[92px] border-b border-r border-slate-100 last:border-r-0 dark:border-slate-800"
                    />
                  );
                const iso = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const d = days[iso];
                const notesForDay = adminNotes[iso] ?? [];
                const hasData = Boolean(
                  (d && (d.logins.length > 0 || d.shifts.length > 0 || d.sign_outs.length > 0)) ||
                    notesForDay.length > 0,
                );
                const isToday = iso === today;
                const summaryLines = [
                  ...(d?.shifts ?? []).map((s, si) => ({
                    key: `sh${si}-${s.time}${s.user_name}`,
                    dot: "bg-emerald-500",
                    text: `${s.user_name} · ${hoursLabel(s.hours)}`,
                  })),
                  ...(d?.logins ?? []).map((l, li) => ({
                    key: `l${li}-${l.time}${l.user_name}`,
                    dot: "bg-brand-500",
                    text: `${l.user_name} logged in`,
                  })),
                  ...(d?.sign_outs ?? []).map((s, si) => ({
                    key: `s${si}-${s.time}${s.item_name}`,
                    dot: "bg-amber-500",
                    text: `${fmtQty(s.qty, s.unit)} ${s.item_name}`,
                  })),
                  ...notesForDay.map((n) => ({
                    key: `n${n.id}`,
                    dot: "bg-violet-500",
                    text: n.title,
                  })),
                ];
                const shown = summaryLines.slice(0, 3);
                const hiddenCount = summaryLines.length - shown.length;
                return (
                  <button
                    key={i}
                    onClick={() => setSelected(iso)}
                    className={`flex min-h-[92px] cursor-pointer flex-col items-start gap-1 border-b border-r p-2 text-left transition-colors last:border-r-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 md:min-h-[132px] lg:min-h-[150px] ${
                      (i + 1) % 7 === 0 ? "border-r-0" : "border-slate-100"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold ${
                          isToday ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {day}
                      </span>
                      {hasData && (
                        <span className="flex gap-1 md:hidden">
                          {(d?.shifts.length ?? 0) > 0 && (
                            <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              {d!.shifts.length}
                            </span>
                          )}
                          {(d?.sign_outs.length ?? 0) > 0 && (
                            <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              {d!.sign_outs.length}
                            </span>
                          )}
                          {notesForDay.length > 0 && (
                            <span className="badge bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                              {notesForDay.length}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    {shown.length > 0 && (
                      <span className="hidden w-full min-w-0 flex-col gap-0.5 md:flex">
                        {shown.map((line) => (
                          <span
                            key={line.key}
                            className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400"
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${line.dot}`} />
                            <span className="truncate">{line.text}</span>
                          </span>
                        ))}
                        {hiddenCount > 0 && (
                          <span className="pl-3 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                            +{hiddenCount} more
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {liveLoading ? (
        <ListSkeleton rows={3} />
      ) : (
        <>
          {/* Live now */}
          <div>
            <p className="section-title mb-2.5 flex items-center gap-1.5">
              <Icon name="map-pin" size={14} />
              Live now
            </p>
            {located.length > 0 && (
              <div className="mb-3 overflow-hidden rounded-2xl border border-slate-200/70 shadow-card dark:border-slate-800">
                <MapContainer center={center} zoom={11} style={{ height: 380, width: "100%" }}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.esri.com">Esri</a>'
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                  />
                  {clusterWorkers(located).map((c) => (
                    <Marker key={`${c.lat},${c.lng}`} position={[c.lat, c.lng]} icon={pinIcon(c.members.length)}>
                      <Popup>
                        {c.members.map((w, i) => (
                          <div key={w.user_id} className={i > 0 ? "mt-2 border-t border-slate-200 pt-2" : ""}>
                            <span className="font-semibold">{w.user_name}</span>
                            {w.job_number && (
                              <>
                                <br />
                                {w.job_number}
                                {w.job_name ? ` — ${w.job_name}` : ""}
                              </>
                            )}
                            <br />
                            Clocked in{" "}
                            {new Date(w.clock_in_at).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                            <br />
                            Location: {timeAgo(w.last_ping_at)}
                          </div>
                        ))}
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            )}
            {(live ?? []).length === 0 ? (
              <Empty icon="map-pin" title="Nobody's clocked in" hint="Techs who clock in from the app will show up here." />
            ) : (
              <div className="space-y-2">
                {(live ?? []).map((w) => (
                  <div key={w.user_id} className="card flex items-center justify-between gap-3 p-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13.5px] font-semibold">{w.user_name}</p>
                        <ApprovalBadge status={w.approval_status} />
                      </div>
                      {w.job_number && (
                        <p className="truncate text-[12px] font-medium text-brand-600 dark:text-brand-400">
                          {w.job_number}
                          {w.job_name ? ` — ${w.job_name}` : ""}
                        </p>
                      )}
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">
                        Since{" "}
                        {new Date(w.clock_in_at).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <p className="shrink-0 text-[12px] text-slate-400 dark:text-slate-500">
                      {timeAgo(w.last_ping_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All techs, with their login history underneath */}
          <div>
            <p className="section-title mb-2.5 flex items-center gap-1.5">
              <Icon name="clock" size={14} />
              All techs
            </p>
            {(techs ?? []).length === 0 ? (
              <Empty icon="users" title="No techs yet" hint="Add techs in Settings." />
            ) : (
              <div className="space-y-4">
                {(techs ?? []).map((tech, i) => {
                  const sheet = timesheets[tech.id];
                  const shifts = sheet?.shifts.slice(0, SHIFTS_PER_TECH) ?? [];
                  const onClockNow = liveById.get(tech.id);
                  return (
                    <div key={tech.id} className="card p-3.5">
                      <div className="mb-2.5 flex items-center gap-3">
                        <Avatar name={tech.name} index={i} size={36} />
                        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{tech.name}</span>
                        {onClockNow && (
                          <span className="badge shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            Clocked in
                          </span>
                        )}
                        {sheet && (
                          <span className="badge stat-number shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {hoursLabel(sheet.total_hours)} total
                          </span>
                        )}
                      </div>
                      {shifts.length === 0 ? (
                        <p className="px-1 text-[12.5px] text-slate-400 dark:text-slate-500">No logins yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {shifts.map((s) => (
                            <div
                              key={s.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => openRoute(s.id)}
                              onKeyDown={(e) => e.key === "Enter" && openRoute(s.id)}
                              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-left transition-colors hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="truncate text-[13px] font-medium">{fmtWhen(s.clock_in_at)}</p>
                                  <ApprovalBadge status={s.approval_status} />
                                </div>
                                <p className="truncate text-[11.5px] text-slate-400 dark:text-slate-500">
                                  {s.job_number ? `${s.job_number}${s.job_name ? ` — ${s.job_name}` : ""} · ` : ""}
                                  {s.still_clocked_in ? (
                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                      still clocked in
                                    </span>
                                  ) : (
                                    `out ${fmtWhen(s.clock_out_at!)}`
                                  )}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2.5">
                                <span className="text-[12.5px] font-bold tabular-nums">{hoursLabel(s.hours)}</span>
                                <button
                                  type="button"
                                  disabled={approving === s.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShiftApproval(tech.id, s.id, s.approval_status === "pending");
                                  }}
                                  className="btn-secondary !min-h-0 px-2.5 py-1.5 text-[12px]"
                                >
                                  {approving === s.id ? (
                                    <Spinner />
                                  ) : (
                                    <Icon name={s.approval_status === "pending" ? "check" : "x"} size={13} />
                                  )}
                                  {s.approval_status === "pending" ? "Approve" : "Unapprove"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {sheet && sheet.shifts.length > SHIFTS_PER_TECH && (
                        <p className="mt-2 px-1 text-[11.5px] text-slate-400 dark:text-slate-500">
                          +{sheet.shifts.length - SHIFTS_PER_TECH} more below in the calendar
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
      {selected && (
        <Sheet
          title={new Date(selected + "T00:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
          onClose={() => {
            setSelected(null);
            closeNoteEditor();
            setNewNoteTitle("");
            setNewNoteText("");
          }}
        >
          <div className="space-y-5">
            <div>
              <h2 className="section-title flex items-center gap-1.5">
                <Icon name="lock" size={14} />
                Personal notes ({(adminNotes[selected] ?? []).length})
              </h2>
              {(adminNotes[selected] ?? []).length === 0 ? (
                <p className="px-1 text-[12.5px] text-slate-400 dark:text-slate-500">
                  Only admins can see these — never shown to techs.
                </p>
              ) : (
                <div className="space-y-2">
                  {(adminNotes[selected] ?? []).map((n) => {
                    const isOpen = noteExpandedId === n.id;
                    return (
                      <div key={n.id} className="rounded-xl bg-violet-50/60 dark:bg-violet-500/10">
                        <div className="flex items-start gap-3 p-3">
                          <button
                            type="button"
                            aria-label={n.done ? "Mark not done" : "Mark done"}
                            onClick={() => toggleNoteDone(n)}
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                              n.done
                                ? "border-violet-500 bg-violet-500 text-white"
                                : "border-violet-300 dark:border-violet-700"
                            }`}
                          >
                            {n.done && <Icon name="check" size={12} strokeWidth={3} />}
                          </button>
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => (isOpen ? closeNoteEditor() : startNoteEdit(n))}
                          >
                            <span
                              className={`block truncate text-[14px] font-semibold ${n.done ? "text-slate-400 line-through" : ""}`}
                            >
                              {n.title}
                            </span>
                            {n.notes && !isOpen && (
                              <span className="mt-0.5 block truncate text-[12px] text-slate-500 dark:text-slate-400">
                                {n.notes}
                              </span>
                            )}
                          </button>
                          <Icon
                            name={isOpen ? "chevron-down" : "chevron-right"}
                            size={16}
                            className="mt-1 shrink-0 text-slate-300"
                          />
                        </div>
                        {isOpen && noteEditDraft && (
                          <div className="space-y-3 border-t border-violet-200/70 p-3 dark:border-violet-800/60">
                            <label className="block">
                              <span className="label">Title</span>
                              <input
                                className="input"
                                value={noteEditDraft.title}
                                onChange={(e) => setNoteEditDraft({ ...noteEditDraft, title: e.target.value })}
                              />
                            </label>
                            <label className="block">
                              <span className="label">Date</span>
                              <input
                                type="date"
                                className="input"
                                value={noteEditDraft.event_date}
                                onChange={(e) => setNoteEditDraft({ ...noteEditDraft, event_date: e.target.value })}
                              />
                            </label>
                            <label className="block">
                              <span className="label">Notes</span>
                              <textarea
                                className="input min-h-[70px]"
                                value={noteEditDraft.notes}
                                onChange={(e) => setNoteEditDraft({ ...noteEditDraft, notes: e.target.value })}
                              />
                            </label>
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                className="btn-ghost text-red-600 dark:text-red-400"
                                onClick={() => deleteNote(n)}
                              >
                                <Icon name="trash" size={16} />
                                Delete
                              </button>
                              <div className="flex gap-2">
                                <button type="button" className="btn-ghost" onClick={closeNoteEditor}>
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="btn-primary"
                                  disabled={noteSaving || !noteEditDraft.title.trim()}
                                  onClick={() => saveNoteEdit(n)}
                                >
                                  {noteSaving ? <Spinner /> : "Save"}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="space-y-2.5 pt-3">
                <input
                  className="input"
                  placeholder="Add a personal note or to-do…"
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                />
                <textarea
                  className="input min-h-[50px]"
                  placeholder="Details (optional)"
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={noteSaving || !newNoteTitle.trim()}
                  onClick={addNote}
                >
                  {noteSaving ? (
                    <Spinner />
                  ) : (
                    <>
                      <Icon name="plus" size={18} />
                      Add note
                    </>
                  )}
                </button>
              </div>
            </div>

            <div>
              <h2 className="section-title flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Icon name="clock" size={14} />
                  Shifts ({selectedData?.shifts.length ?? 0})
                </span>
                {selectedData && selectedData.shifts.length > 0 && (
                  <span className="badge stat-number bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    {hoursLabel(selectedTotalHours)} total
                  </span>
                )}
              </h2>
              {selectedData && selectedData.shifts.length > 0 ? (
                <div className="space-y-2">
                  {selectedData.shifts.map((s) => (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openRoute(s.id)}
                      onKeyDown={(e) => e.key === "Enter" && openRoute(s.id)}
                      className="cursor-pointer rounded-xl bg-slate-50 px-3.5 py-2.5 transition-colors hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                    >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold">{s.user_name}</span>
                          <ApprovalBadge status={s.approval_status} />
                        </div>
                        <p className="truncate text-[12px] text-slate-400 dark:text-slate-500">
                          {s.job_number ? `${s.job_number}${s.job_name ? ` — ${s.job_name}` : ""} · ` : ""}
                          {s.time} –{" "}
                          {s.still_clocked_in ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              still clocked in
                            </span>
                          ) : (
                            s.clock_out_time
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2.5">
                        <span className="text-[13.5px] font-bold tabular-nums">{hoursLabel(s.hours)}</span>
                        <button
                          type="button"
                          disabled={approving === s.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setShiftApproval(null, s.id, s.approval_status === "pending");
                          }}
                          className="btn-secondary !min-h-0 px-2.5 py-1.5 text-[12px]"
                        >
                          {approving === s.id ? (
                            <Spinner />
                          ) : (
                            <Icon name={s.approval_status === "pending" ? "check" : "x"} size={13} />
                          )}
                          {s.approval_status === "pending" ? "Approve" : "Unapprove"}
                        </button>
                      </div>
                    </div>
                    {s.note && (
                      <p className="mt-2 border-t border-slate-200/70 pt-2 text-[12.5px] italic text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        "{s.note}"
                      </p>
                    )}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty icon="clock" title="No shifts" hint="Nobody clocked in this day." />
              )}
            </div>

            <div>
              <h2 className="section-title">
                <Icon name="users" size={14} />
                Logins ({selectedData?.logins.length ?? 0})
              </h2>
              {selectedData && selectedData.logins.length > 0 ? (
                <div className="space-y-2">
                  {selectedData.logins.map((l, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-slate-800/60"
                    >
                      <span className="font-semibold">{l.user_name}</span>
                      <span className="flex items-center gap-2 text-[13px] text-slate-400 dark:text-slate-500">
                        {l.role === "admin" && (
                          <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            admin
                          </span>
                        )}
                        {l.time}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty icon="users" title="No logins" hint="Nobody tapped in this day." />
              )}
            </div>

            <div>
              <h2 className="section-title">
                <Icon name="package" size={14} />
                Signed out ({selectedData?.sign_outs.length ?? 0})
              </h2>
              {selectedData && selectedData.sign_outs.length > 0 ? (
                <div className="space-y-2">
                  {selectedData.sign_outs.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-slate-800/60"
                    >
                      <ItemThumb item={{ image_data: s.image_data }} shape="square" size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">{s.item_name}</span>
                          <span className="shrink-0 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                            {s.time}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-slate-400 dark:text-slate-500">
                          <span>{fmtQty(s.qty, s.unit)}</span>
                          <span>·</span>
                          <span>{s.user_name}</span>
                          {s.job_name && (
                            <>
                              <span>·</span>
                              <span>
                                {s.job_number} {s.job_name}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty icon="package" title="Nothing signed out" hint="No material left the shop this day." />
              )}
            </div>
          </div>
        </Sheet>
      )}

      {routeShiftId !== null && (
        <Sheet
          title={route ? `${route.user_name}'s route` : "Loading route…"}
          subtitle={
            route
              ? `${route.job_number ? `${route.job_number}${route.job_name ? ` — ${route.job_name}` : ""} · ` : ""}${fmtWhen(route.clock_in_at)} → ${route.clock_out_at ? fmtWhen(route.clock_out_at) : "still clocked in"}`
              : undefined
          }
          onClose={() => {
            setRouteShiftId(null);
            setRoute(null);
          }}
        >
          {routeLoading ? (
            <div className="py-10">
              <ListSkeleton rows={1} />
            </div>
          ) : !route || route.points.length === 0 ? (
            <div className="py-4">
              <Empty
                icon="map-pin"
                title="No GPS points for this shift"
                hint="Location wasn't captured for this clock-in/out."
              />
            </div>
          ) : (
            <div className="space-y-3 pb-2">
              <div className="overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800">
                <MapContainer
                  center={[route.points[0].lat, route.points[0].lng]}
                  zoom={15}
                  style={{ height: 340, width: "100%" }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.esri.com">Esri</a>'
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                  />
                  <FitToRoute points={route.points} />
                  <Polyline
                    positions={route.points.map((p) => [p.lat, p.lng])}
                    pathOptions={{ color: "#3e64ee", weight: 4, opacity: 0.8 }}
                  />
                  {route.points.map((p, i) => (
                    <CircleMarker
                      key={i}
                      center={[p.lat, p.lng]}
                      radius={p.kind === "ping" ? 5 : 9}
                      pathOptions={{ color: "#fff", weight: 2, fillColor: KIND_COLOR[p.kind], fillOpacity: 1 }}
                    >
                      <Popup>
                        {p.kind === "clock_in" ? "Clocked in" : p.kind === "clock_out" ? "Clocked out" : "Location"}
                        <br />
                        {new Date(p.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>
              <div className="flex items-center justify-center gap-4 text-[12px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Clock in
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> GPS ping
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Clock out
                </span>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
