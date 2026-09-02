import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

import { api, fmtWhen } from "../../api";
import Icon from "../../components/Icon";
import { Avatar, Empty, ListSkeleton, Spinner } from "../../components/ui";
import { hoursLabel } from "../../hours";
import { useToast } from "../../toast";
import type { User, WorkerLive } from "../../types";

// Custom pin so we don't depend on leaflet's default marker image assets
// resolving correctly under Vite's bundler. A count badge is added for
// clusters of 2+ techs standing at (nearly) the same spot, so overlapping
// markers never just silently hide each other.
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

// Groups techs standing within ~11m of each other (4 decimal places of
// lat/lng) into one cluster, so identical/near-identical coordinates render
// as a single pin with a count instead of stacking invisibly.
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

function timeAgo(iso: string | null) {
  if (!iso) return "no location yet";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

export default function WorkerMap() {
  const toast = useToast();
  const [live, setLive] = useState<WorkerLive[] | null>(null);
  const [techs, setTechs] = useState<User[] | null>(null);
  const [timesheets, setTimesheets] = useState<Record<number, TechTimesheet>>({});
  const [approving, setApproving] = useState<number | null>(null);

  const approveShift = async (userId: number, shiftId: number) => {
    setApproving(shiftId);
    try {
      await api(`/time/${shiftId}/approve`, { method: "POST" });
      setTimesheets((prev) => {
        const sheet = prev[userId];
        if (!sheet) return prev;
        return {
          ...prev,
          [userId]: {
            ...sheet,
            shifts: sheet.shifts.map((s) => (s.id === shiftId ? { ...s, approval_status: "approved" } : s)),
          },
        };
      });
      toast("success", "Shift approved");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't approve shift");
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
  const loading = live === null || techs === null;

  return (
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">Field techs</p>
        <h1 className="page-title">Login Hours</h1>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
          Who's on the clock right now, and every tech's clock-in history underneath their name.
        </p>
      </div>

      {loading ? (
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
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {clusterWorkers(located).map((c) => (
                    <Marker
                      key={`${c.lat},${c.lng}`}
                      position={[c.lat, c.lng]}
                      icon={pinIcon(c.members.length)}
                    >
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
                        {w.approval_status === "pending" ? (
                          <span className="badge shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                            Pending
                          </span>
                        ) : (
                          <span className="badge shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            Approved
                          </span>
                        )}
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

          {/* Every tech, with their login history underneath */}
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
                              className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="truncate text-[13px] font-medium">{fmtWhen(s.clock_in_at)}</p>
                                  {s.approval_status === "pending" ? (
                                    <span className="badge shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                                      Pending
                                    </span>
                                  ) : (
                                    <span className="badge shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                      Approved
                                    </span>
                                  )}
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
                                {s.approval_status === "pending" && (
                                  <button
                                    type="button"
                                    disabled={approving === s.id}
                                    onClick={() => approveShift(tech.id, s.id)}
                                    className="btn-secondary !min-h-0 px-2.5 py-1.5 text-[12px]"
                                  >
                                    {approving === s.id ? <Spinner /> : <Icon name="check" size={13} />}
                                    Approve
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {sheet && sheet.shifts.length > SHIFTS_PER_TECH && (
                        <p className="mt-2 px-1 text-[11.5px] text-slate-400 dark:text-slate-500">
                          +{sheet.shifts.length - SHIFTS_PER_TECH} more in Reports → Timesheets
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
    </div>
  );
}
