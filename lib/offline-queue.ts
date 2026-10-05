"use client";

/**
 * Cash sales rung up while the register couldn't reach the server. Kept
 * in this browser's localStorage and sent to /api/pos/payment/capture
 * when the connection is back (each carries a client_uuid, so a retried
 * send never creates a duplicate sale).
 */

export type OfflineSale = {
  client_uuid: string;
  /** Full capture request body (includes client_uuid + offline_recorded_at). */
  payload: Record<string, unknown>;
  total: number;
  change: number;
  created_at: string;
  attempts: number;
  /** Set when the server rejected it (not a network problem) — needs a person. */
  error: string | null;
};

const KEY = "pos:offline-sales";
export const QUEUE_EVENT = "pos-offline-queue";

export function readQueue(): OfflineSale[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OfflineSale[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: OfflineSale[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage full / unavailable */
  }
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

export function enqueueOfflineSale(s: OfflineSale) {
  writeQueue([...readQueue(), s]);
}

export function discardOfflineSale(uuid: string) {
  writeQueue(readQueue().filter((s) => s.client_uuid !== uuid));
}

/** True when the POS server (and its database) answers within ~2.5 s. */
export async function serverReachable(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const r = await fetch("/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

let syncing = false;

/**
 * Send queued sales oldest first. Stops at the first network failure
 * (still offline); a server rejection marks that sale for attention and
 * moves on. Returns how many synced.
 */
export async function syncOfflineSales(opts: { includeFailed?: boolean } = {}): Promise<number> {
  if (syncing) return 0;
  syncing = true;
  let done = 0;
  try {
    for (const s of readQueue()) {
      if (s.error && !opts.includeFailed) continue;
      let res: Response;
      try {
        res = await fetch("/api/pos/payment/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(s.payload),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        break; // still offline
      }
      const q = readQueue();
      if (res.ok) {
        writeQueue(q.filter((x) => x.client_uuid !== s.client_uuid));
        done++;
        continue;
      }
      if (res.status === 401 || res.status >= 500) break; // signed out / server down — retry later
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      writeQueue(
        q.map((x) =>
          x.client_uuid === s.client_uuid
            ? { ...x, attempts: x.attempts + 1, error: body.message ?? `Rejected (${res.status})` }
            : x,
        ),
      );
    }
  } finally {
    syncing = false;
  }
  return done;
}
