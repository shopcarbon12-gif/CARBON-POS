import { getPool } from "@/lib/db";
import { wmsFetch, type CashierForWmsFetch } from "@/lib/wms-fetch";

/**
 * Look up the CDM agent UUID for the cashier's currently-open register.
 * Returns null when:
 *   - the cashier has no open session (e.g. just signed in)
 *   - the register has no agent linked (cash/barcode-only register)
 *
 * Callers should treat null as "no reader to control" and respond 200 with
 * a skipped flag rather than erroring — the sell-screen badge handles
 * the UI state.
 */
export async function agentIdForCurrentSession(
  userId: string,
): Promise<string | null> {
  const r = await getPool().query<{ cdm_agent_id: string | null }>(
    `SELECT reg.cdm_agent_id
       FROM pos_register_sessions s
       JOIN pos_registers reg ON reg.id = s.register_id
      WHERE s.status = 'open' AND s.opened_by = $1
      ORDER BY s.opened_at DESC LIMIT 1`,
    [userId],
  );
  return r.rows[0]?.cdm_agent_id ?? null;
}

/**
 * Call WMS's per-agent live-scan endpoint as the cashier. Centralised so
 * start/stop/state share the same error handling.
 *
 * Returns the JSON body on 2xx, or a shaped error object the route can
 * re-emit verbatim.
 */
export async function callAgentLiveScan(
  cashier: CashierForWmsFetch,
  agentId: string,
  action: "start" | "stop" | "state",
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string; message: string }
> {
  const method = action === "state" ? "GET" : "POST";
  const path = `/api/cdm-agents/${agentId}/live-scan/${action}`;
  let res: Response;
  try {
    res = await wmsFetch(cashier, path, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      body: method === "POST" ? "{}" : undefined,
    });
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error: "wms_unreachable",
      message: (err as Error).message,
    };
  }
  if (!res.ok) {
    let j: { error?: string; message?: string } = {};
    try {
      j = (await res.json()) as typeof j;
    } catch {
      /* non-JSON */
    }
    return {
      ok: false,
      status: res.status,
      error: j.error ?? `http_${res.status}`,
      message: j.message ?? `WMS responded ${res.status}`,
    };
  }
  return { ok: true, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
