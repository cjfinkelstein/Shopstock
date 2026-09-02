import { createContext, useContext, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { useAuth } from "./auth";
import type { ClockStatus } from "./types";

interface ClockState {
  clockedIn: boolean;
  clockInAt: string | null;
  jobNumber: string | null;
  jobName: string | null;
  approvalStatus: string | null;
  gpsConsentGiven: boolean;
  loading: boolean;
  clockIn: (jobId: number) => Promise<void>;
  clockOut: () => Promise<void>;
  giveGpsConsent: () => Promise<void>;
}

const ClockContext = createContext<ClockState>(null!);

// How often we send a GPS ping to the server while a tech is clocked in.
const PING_INTERVAL_MS = 90_000;

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
  const [clockedIn, setClockedIn] = useState(false);
  const [clockInAt, setClockInAt] = useState<string | null>(null);
  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [jobName, setJobName] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [gpsConsentGiven, setGpsConsentGiven] = useState(false);
  const [loading, setLoading] = useState(true);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    if (user?.role !== "tech") {
      setLoading(false);
      return;
    }
    refreshStatus().finally(() => setLoading(false));
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
      api("/time/ping", {
        method: "POST",
        body: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      }).catch(() => {});
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

  const clockIn = async (jobId: number) => {
    const pos = await getPosition();
    try {
      const s = await api<ClockStatus>("/time/clock-in", {
        method: "POST",
        body: { job_id: jobId, lat: pos?.coords.latitude, lng: pos?.coords.longitude },
      });
      applyStatus(s);
    } catch (e) {
      // The request may have actually succeeded server-side even though this
      // client never saw the response (dropped connection, deploy blip,
      // etc.) -- resync with the server's real state so the UI can't get
      // stuck showing "not clocked in" while a retry keeps failing because
      // we're secretly already clocked in.
      await refreshStatus();
      throw e;
    }
  };

  const clockOut = async () => {
    const pos = await getPosition();
    try {
      await api("/time/clock-out", {
        method: "POST",
        body: { lat: pos?.coords.latitude, lng: pos?.coords.longitude },
      });
      setClockedIn(false);
      setClockInAt(null);
      setJobNumber(null);
      setJobName(null);
      setApprovalStatus(null);
    } catch (e) {
      // Same resync as clockIn -- if we're actually already clocked out
      // server-side (e.g. an earlier tap succeeded but its response never
      // reached this device), this clears the stale "still clocked in" UI
      // instead of leaving the tech stuck retapping a button that will
      // always fail.
      await refreshStatus();
      throw e;
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
