import { createContext, useContext, useEffect, useRef, useState } from "react";

import { api, ApiError } from "./api";
import { useAuth } from "./auth";
import { enqueueAction, listQueue, removeAction } from "./offlineQueue";
import { useToast } from "./toast";
import type { ClockStatus, Job } from "./types";

// True connectivity trouble worth queuing for later -- either the request
// never reached any server at all (no signal: fetch throws before getting a
// response, so it's not an ApiError), or it reached a reverse proxy that
// couldn't reach the app itself (502/503/504 -- e.g. mid-deploy, container
// restarting). Any other ApiError (400/401/403/404/500, etc.) is a real
// rejection from the app and should surface normally, not get queued.
function isConnectivityError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 502 || e.status === 503 || e.status === 504;
}

interface ClockState {
  clockedIn: boolean;
  clockInAt: string | null;
  jobNumber: string | null;
  jobName: string | null;
  approvalStatus: string | null;
  gpsConsentGiven: boolean;
  loading: boolean;
  // True while offline (or briefly disconnected) and there's a clock-in/out
  // that hasn't reached the server yet -- it's queued locally and will
  // sync automatically once the connection returns.
  offlinePending: boolean;
  clockIn: (job: Job) => Promise<void>;
  clockOut: (note: string) => Promise<void>;
  giveGpsConsent: () => Promise<void>;
}

const ClockContext = createContext<ClockState>(null!);

// How often we send a GPS ping to the server while a tech is clocked in.
const PING_INTERVAL_MS = 120_000;

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30_000 },
    );
  });
}

export function ClockProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const [clockedIn, setClockedIn] = useState(false);
  const [clockInAt, setClockInAt] = useState<string | null>(null);
  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [jobName, setJobName] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [gpsConsentGiven, setGpsConsentGiven] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offlinePending, setOfflinePending] = useState(false);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncing = useRef(false);

  const applyStatus = (s: ClockStatus) => {
    setClockedIn(s.clocked_in);
    setClockInAt(s.clock_in_at ?? null);
    setJobNumber(s.job_number ?? null);
    setJobName(s.job_name ?? null);
    setApprovalStatus(s.approval_status ?? null);
    setGpsConsentGiven(s.gps_consent_given);
  };

  const refreshStatus = () =>
    api<ClockStatus>("/time/status")
      .then(applyStatus)
      .catch(() => {
        setClockedIn(false);
        setClockInAt(null);
        setJobNumber(null);
        setJobName(null);
        setApprovalStatus(null);
        setGpsConsentGiven(false);
      });

  // Replays queued clock-in/out actions in order against the real API once
  // a connection is available. Stops at the first item that's still
  // unreachable (leaves it and everything after it queued for next time),
  // but resolves a benign "already applied" duplicate (e.g. the server
  // actually got an earlier attempt whose response never arrived) as a
  // success rather than looping on it forever.
  const syncQueue = async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const queue = await listQueue();
      let changed = false;
      for (const action of queue) {
        try {
          if (action.type === "clock_in") {
            await api<ClockStatus>("/time/clock-in", { method: "POST", body: action.payload });
          } else if (action.type === "clock_out") {
            await api("/time/clock-out", { method: "POST", body: action.payload });
          } else {
            await api("/time/ping", { method: "POST", body: action.payload });
          }
          await removeAction(action.id);
          changed = true;
        } catch (e) {
          if (isConnectivityError(e)) {
            // Still no connection (or the server's still unreachable) --
            // stop here, keep the rest queued, try again later.
            break;
          }
          const benign =
            e instanceof ApiError &&
            ((action.type === "clock_in" && /already clocked in/i.test(e.message)) ||
              (action.type === "clock_out" && /not clocked in/i.test(e.message)) ||
              // A queued ping from a shift that's since ended (clocked out
              // while still offline, or synced from another device) --
              // there's nothing left to attach the point to, and it's not
              // worth alarming the tech over a dropped position ping.
              (action.type === "ping" && /not clocked in/i.test(e.message)));
          await removeAction(action.id);
          changed = true;
          if (!benign) {
            const what =
              action.type === "clock_in"
                ? "A queued clock in"
                : action.type === "clock_out"
                  ? "A queued clock out"
                  : "A queued GPS ping";
            toast(
              "error",
              `${what} from earlier couldn't go through (${e instanceof Error ? e.message : "unknown error"}). Please check your status.`,
            );
          }
        }
      }
      if (changed) {
        await refreshStatus();
        const remaining = await listQueue();
        setOfflinePending(remaining.length > 0);
      }
    } finally {
      syncing.current = false;
    }
  };

  useEffect(() => {
    if (user?.role !== "tech") {
      setLoading(false);
      return;
    }
    listQueue().then((q) => setOfflinePending(q.length > 0));
    refreshStatus()
      .then(syncQueue)
      .finally(() => setLoading(false));
  }, [user?.id, user?.role]);

  // Catch reconnection from any signal -- the browser's 'online' event, or a
  // periodic check, since 'online' doesn't always fire reliably on flaky
  // (as opposed to fully absent) connections.
  useEffect(() => {
    if (user?.role !== "tech") return;
    const onOnline = () => syncQueue();
    window.addEventListener("online", onOnline);
    const t = setInterval(() => {
      if (navigator.onLine) syncQueue();
    }, 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(t);
    };
  }, [user?.id, user?.role]);

  // Ping loop lives here (not on any one page) so it keeps running no
  // matter which tech screen is open, for as long as the shift is active.
  useEffect(() => {
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
    if (!clockedIn) return;

    const sendPing = async () => {
      const pos = await getPosition();
      if (!pos) return;
      const body = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        recorded_at: new Date().toISOString(),
        client_ref: crypto.randomUUID(),
      };
      try {
        await api("/time/ping", { method: "POST", body });
      } catch (e) {
        if (isConnectivityError(e)) {
          // No connection right now -- queue it so the shift's route in
          // the admin map doesn't get a gap, and it'll sync (with the
          // moment it was actually captured, via recorded_at) once a
          // connection returns.
          await enqueueAction("ping", body);
          setOfflinePending(true);
        }
        // A real rejection (e.g. clocked out from another device in the
        // meantime) isn't worth queuing or alarming the tech over.
      }
    };

    sendPing();
    pingTimer.current = setInterval(sendPing, PING_INTERVAL_MS);
    return () => {
      if (pingTimer.current) clearInterval(pingTimer.current);
    };
  }, [clockedIn]);

  const giveGpsConsent = async () => {
    const s = await api<ClockStatus>("/time/gps-consent", { method: "POST" });
    applyStatus(s);
  };

  const clockIn = async (job: Job) => {
    const pos = await getPosition();
    const body = { job_id: job.id, lat: pos?.coords.latitude, lng: pos?.coords.longitude };
    try {
      const s = await api<ClockStatus>("/time/clock-in", { method: "POST", body });
      applyStatus(s);
    } catch (e) {
      if (!isConnectivityError(e)) {
        // The request may have actually succeeded server-side even though
        // this client never saw the response (dropped connection, deploy
        // blip, etc.) -- resync with the server's real state so the UI
        // can't get stuck showing "not clocked in" while a retry keeps
        // failing because we're secretly already clocked in.
        await refreshStatus();
        throw e;
      }
      // No connection at all -- queue it and reflect the clock-in locally
      // so a tech at a low-signal job site isn't blocked from working.
      // It'll sync (and get corrected if anything's actually wrong) as
      // soon as a connection is available.
      await enqueueAction("clock_in", body);
      setClockedIn(true);
      setClockInAt(new Date().toISOString());
      setJobNumber(job.job_number);
      setJobName(job.name);
      setApprovalStatus("pending");
      setOfflinePending(true);
    }
  };

  const clockOut = async (note: string) => {
    const pos = await getPosition();
    const body = { lat: pos?.coords.latitude, lng: pos?.coords.longitude, note };
    try {
      await api("/time/clock-out", { method: "POST", body });
      setClockedIn(false);
      setClockInAt(null);
      setJobNumber(null);
      setJobName(null);
      setApprovalStatus(null);
    } catch (e) {
      if (!isConnectivityError(e)) {
        // Same resync as clockIn -- if we're actually already clocked out
        // server-side (e.g. an earlier tap succeeded but its response never
        // reached this device), this clears the stale "still clocked in" UI
        // instead of leaving the tech stuck retapping a button that will
        // always fail.
        await refreshStatus();
        throw e;
      }
      await enqueueAction("clock_out", body);
      setClockedIn(false);
      setClockInAt(null);
      setJobNumber(null);
      setJobName(null);
      setApprovalStatus(null);
      setOfflinePending(true);
    }
  };

  return (
    <ClockContext.Provider
      value={{
        clockedIn,
        clockInAt,
        jobNumber,
        jobName,
        approvalStatus,
        gpsConsentGiven,
        loading,
        offlinePending,
        clockIn,
        clockOut,
        giveGpsConsent,
      }}
    >
      {children}
    </ClockContext.Provider>
  );
}

export function useClock() {
  return useContext(ClockContext);
}
