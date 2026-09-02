import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

import { api } from "../../api";
import { Empty, ListSkeleton } from "../../components/ui";
import type { WorkerLive } from "../../types";

// Custom pin so we don't depend on leaflet's default marker image assets
// resolving correctly under Vite's bundler.
const pin = L.divIcon({
  className: "",
  html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
    background:#0ea5e9;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -28],
});

const REFRESH_MS = 20_000;
const DEFAULT_CENTER: [number, number] = [39.2904, -76.6122]; // Baltimore, MD

function timeAgo(iso: string | null) {
  if (!iso) return "no location yet";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

export default function WorkerMap() {
  const [workers, setWorkers] = useState<WorkerLive[] | null>(null);

  useEffect(() => {
    const load = () => api<WorkerLive[]>("/time/live").then(setWorkers).catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const located = (workers ?? []).filter((w) => w.lat != null && w.lng != null);
  const center: [number, number] = located[0] ? [located[0].lat!, located[0].lng!] : DEFAULT_CENTER;

  return (
    <div className="space-y-5">
      <div>
        <p className="page-eyebrow">Field techs</p>
        <h1 className="page-title">Worker Map</h1>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
          Techs currently clocked in, with their last reported location. Refreshes every{" "}
          {REFRESH_MS / 1000}s.
        </p>
      </div>

      {workers === null ? (
        <ListSkeleton rows={3} />
      ) : workers.length === 0 ? (
        <Empty icon="map-pin" title="Nobody's clocked in" hint="Techs who clock in from the app will show up here." />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-slate-200/70 shadow-card dark:border-slate-800">
            <MapContainer center={center} zoom={11} style={{ height: 440, width: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {located.map((w) => (
                <Marker key={w.user_id} position={[w.lat!, w.lng!]} icon={pin}>
                  <Popup>
                    <span className="font-semibold">{w.user_name}</span>
                    <br />
                    Clocked in {new Date(w.clock_in_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    <br />
                    Location: {timeAgo(w.last_ping_at)}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          <div className="space-y-2">
            {workers.map((w) => (
              <div key={w.user_id} className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold">{w.user_name}</p>
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
        </>
      )}
    </div>
  );
}
