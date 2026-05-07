import { randomUUID } from "crypto";
import type { PoolClient } from "pg";

/**
 * Server-to-server HTTP client for loyalty.shopcarbon.com.
 *
 * Two paths:
 *   - postViaOutbox: queue the call inside the current DB transaction.
 *     Always succeeds (we just write a row). A worker drains it later.
 *   - postDirect:    fire-and-forget. Used for non-critical reads (the
 *     balance pill on customer-attach) where blocking the cashier is
 *     unacceptable.
 *
 * Both use the LOYALTY_API_KEY bearer auth.
 */

const BASE = process.env.LOYALTY_API_BASE_URL?.trim() || "https://loyalty.shopcarbon.com";
const KEY = process.env.LOYALTY_API_KEY?.trim() || "";

type OutboxEndpoint =
  | "/api/v1/earn"
  | "/api/v1/redeem"
  | "/api/v1/refund"
  | "/api/v1/customers/link"
  | "/api/admin/adjust";

/**
 * Queue a loyalty call inside a Postgres transaction. The capture-route
 * already runs in `withTransaction` — we piggyback on it so the queue
 * row commits atomically with the sale.
 */
export async function queueLoyaltyCall(
  client: PoolClient,
  endpoint: OutboxEndpoint,
  payload: Record<string, unknown>,
): Promise<{ idempotency_key: string }> {
  const idempotencyKey =
    (payload.idempotency_key as string | undefined) ?? randomUUID();
  await client.query(
    `INSERT INTO pos_loyalty_outbox (endpoint, payload, idempotency_key)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [endpoint, JSON.stringify({ ...payload, idempotency_key: idempotencyKey }), idempotencyKey],
  );
  return { idempotency_key: idempotencyKey };
}

/**
 * Direct HTTP call. For reads only (or fire-and-forget writes where
 * losing one is acceptable). Returns the JSON body, or null on error.
 */
export async function loyaltyGet<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!BASE || !KEY) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      method: "GET",
      headers: {
        Authorization: `Bearer ${KEY}`,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loyaltyPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  if (!BASE || !KEY) return { ok: false, status: 0, message: "loyalty_not_configured" };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, status: res.status, message: j.message ?? `http_${res.status}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, status: 0, message: (err as Error).message };
  }
}
