import { ApiError, api, getToken } from "./api";

export type OutboxKind = "sign-out" | "return" | "transfer";

export interface OutboxEntry {
  id: string; // client_ref
  kind: OutboxKind;
  body: Record<string, unknown>;
  summary: string; // human-readable line for the review sheet, e.g. "50 ft 12/2 Romex · Shop -> JOB-3"
  createdAt: string;
  queuedByUserId: number | null;
  status: "pending" | "failed";
  error?: string;
}

const KEY = "shopstock_outbox";
const PATH: Record<OutboxKind, string> = {
  "sign-out": "/transactions/sign-out",
  return: "/transactions/return",
  transfer: "/transactions/transfer",
};

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: OutboxEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable -- the queue just won't survive a reload */
  }
  listeners.forEach((l) => l());
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getQueue(): OutboxEntry[] {
  return read();
}

/** Unverified, client-side only -- decides whose queue an entry belongs to
 * so a shared phone can't sync one tech's queued write under a different
 * tech's name after a login switch. Not a security boundary; the server
 * still records whoever's token actually sends the request. */
function currentUserId(): number | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = JSON.parse(json).sub;
    return sub != null ? Number(sub) : null;
  } catch {
    return null;
  }
}

/** Sends a sign-out/return/transfer write. If the server actually rejects
 * it (bad qty, job closed, etc.) that's thrown for the caller to show as
 * an error, same as before. If the network itself is unreachable, it's
 * queued for later instead -- callers should show a distinct "queued, will
 * sync" state so a tech never mistakes a pending write for a done one. */
export async function sendOrQueue(
  kind: OutboxKind,
  body: Record<string, unknown>,
  summary: string,
): Promise<{ status: "confirmed" } | { status: "queued" }> {
  const client_ref = crypto.randomUUID();
  try {
    await api(PATH[kind], { method: "POST", body: { ...body, client_ref } });
    return { status: "confirmed" };
  } catch (e) {
    if (e instanceof ApiError) throw e; // a real rejection -- not a connectivity problem
    write([
      ...read(),
      {
        id: client_ref,
        kind,
        body,
        summary,
        createdAt: new Date().toISOString(),
        queuedByUserId: currentUserId(),
        status: "pending",
      },
    ]);
    return { status: "queued" };
  }
}

export function retryEntry(id: string) {
  write(read().map((e) => (e.id === id ? { ...e, status: "pending", error: undefined } : e)));
  void flushOutbox();
}

export function discardEntry(id: string) {
  write(read().filter((e) => e.id !== id));
}

let flushing = false;

/** Retries every queued write for the CURRENT user, oldest first.
 * Independent per entry: one failing outright (the server rejects it, once
 * reachable -- e.g. the job closed while offline) doesn't block the rest;
 * it's marked "failed" and left for a person to retry or discard rather
 * than retried forever automatically. Entries queued by a different user
 * (a shared phone, tech switched) are left alone until that user is back. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const mine = currentUserId();
    for (const entry of read()) {
      if (entry.status === "failed") continue;
      if (entry.queuedByUserId !== mine) continue;
      try {
        await api(PATH[entry.kind], {
          method: "POST",
          body: { ...entry.body, client_ref: entry.id },
        });
        write(read().filter((e) => e.id !== entry.id));
      } catch (e) {
        if (e instanceof ApiError) {
          write(
            read().map((x) => (x.id === entry.id ? { ...x, status: "failed", error: e.message } : x)),
          );
        }
        // else: still offline -- leave it pending, the next flush will retry
      }
    }
  } finally {
    flushing = false;
  }
}
