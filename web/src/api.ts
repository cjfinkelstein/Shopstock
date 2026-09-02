const API = "/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let token: string | null = localStorage.getItem("shopstock_token");
let onUnauthorized: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("shopstock_token", t);
  else localStorage.removeItem("shopstock_token");
}

export function getToken() {
  return token;
}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(API + path, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    // Only treat this as a dead session if we WERE holding a token -- a 401
    // on /auth/tap or /auth/login with no token yet just means wrong
    // PIN/password, not an expired session.
    if (token) {
      setToken(null);
      onUnauthorized?.();
      throw new ApiError("Session expired — tap in again", 401);
    }
    let detail = "Wrong PIN or password";
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
    } catch {
      /* not json */
    }
    throw new ApiError(detail, 401);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail[0]?.msg ?? detail;
    } catch {
      /* not json */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

/** Fetch a protected endpoint and hand back a Blob (labels page, CSV downloads). */
export async function apiBlob(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<Blob> {
  const res = await fetch(API + path, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.statusText, res.status);
  return res.blob();
}

export async function downloadCsv(path: string, filename: string) {
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Format a UTC ISO timestamp in America/New_York. */
export function fmtWhen(iso: string): string {
  const s = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(s).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtQty(qty: string | number, unit?: string): string {
  const n = typeof qty === "string" ? parseFloat(qty) : qty;
  const txt = Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/\.?0+$/, "");
  if (unit === "foot") return `${txt} ft`;
  if (unit === "box") return `${txt} box${n === 1 ? "" : "es"}`;
  return txt;
}

export function fmtMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
