/** Offline action queue for tech-facing writes (clock in/out and the
 * periodic GPS ping while on shift; material sign-out is a planned
 * follow-up). When a write fails because the device has no connection --
 * not because the server rejected it -- the action is stored here and
 * replayed in the same order once connectivity returns. Uses IndexedDB
 * rather than localStorage since it's async and safe to grow without
 * blocking the main thread. */

const DB_NAME = "shopstock-offline";
const DB_VERSION = 1;
const STORE = "queue";

export type QueuedActionType = "clock_in" | "clock_out" | "ping";

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  payload: Record<string, unknown>;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueueAction(
  type: QueuedActionType,
  payload: Record<string, unknown>,
): Promise<QueuedAction> {
  const action: QueuedAction = { id: uuid(), type, payload, createdAt: new Date().toISOString() };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(action);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return action;
}

/** Oldest first -- ordering matters (a queued clock-in must replay before a
 * queued clock-out for the same shift). */
export async function listQueue(): Promise<QueuedAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = req.result as QueuedAction[];
      rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function removeAction(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
