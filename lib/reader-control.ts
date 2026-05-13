import { getPool } from "@/lib/db";
import { wmsFetch, type CashierForWmsFetch } from "@/lib/wms-fetch";

export type AgentAndReaders = {
  agent_id: string;
  reader_ids: string[];
};

/**
 * Look up the CDM agent + all reader UUIDs for the cashier's currently-
 * open register. Returns null when:
 *   - the cashier has no open session (e.g. just signed in)
 *   - the register has no agent linked (cash/barcode-only register)
 *
 * The reader_ids list is what we toggle scan_paused_at on — the agent's
 * `live_scan_active` is one of TWO gates the CDM supervisor checks
 * before spawning the reader binary; `devices.scan_paused_at` is the
 * other. Hardware Config's Start/Stop button only flips the latter, so
 * POS has to flip BOTH to reliably bring a reader up or down.
 */
export async function agentAndReadersForCurrentSession(
  userId: string,
): Promise<AgentAndReaders | null> {
  const r = await getPool().query<{ agent_id: string; reader_id: string }>(
    `SELECT reg.cdm_agent_id::text AS agent_id,
            d.id::text             AS reader_id
       FROM pos_register_sessions s
       JOIN pos_registers reg ON reg.id = s.register_id
       JOIN devices d         ON d.cdm_agent_id = reg.cdm_agent_id
                            AND d.device_type IN
                                ('fixed_reader','transaction_reader','door_reader')
      WHERE s.status = 'open' AND s.opened_by = $1
      ORDER BY s.opened_at DESC`,
    [userId],
  );
  if (r.rowCount === 0) return null;
  return {
    agent_id: r.rows[0].agent_id,
    reader_ids: r.rows.map((row) => row.reader_id),
  };
}

/** Back-compat wrapper for callers that only need the agent id. */
export async function agentIdForCurrentSession(
  userId: string,
): Promise<string | null> {
  const v = await agentAndReadersForCurrentSession(userId);
  return v?.agent_id ?? null;
}

/**
 * Clear the Hardware-Config pause flag on every reader under the
 * cashier's agent. Combined with live_scan_active=true on the agent,
 * this makes the CDM supervisor spawn the reader binary. Done as a
 * direct DB write so non-admin cashiers can use it without escalating
 * to the WMS admin-gated /api/hardware-config/readers/{id}/resume.
 */
export async function clearReaderPause(readerIds: string[]): Promise<void> {
  if (readerIds.length === 0) return;
  await getPool().query(
    `UPDATE devices
        SET scan_paused_at = NULL,
            scan_paused_by = NULL,
            updated_at     = now()
      WHERE id = ANY($1::uuid[])`,
    [readerIds],
  );
}

/** Set the Hardware-Config pause flag — symmetric with clearReaderPause. */
export async function setReaderPause(
  readerIds: string[],
  cashierUserId: string,
): Promise<void> {
  if (readerIds.length === 0) return;
  await getPool().query(
    `UPDATE devices
        SET scan_paused_at = now(),
            scan_paused_by = $2::uuid,
            updated_at     = now()
      WHERE id = ANY($1::uuid[])
        AND scan_paused_at IS NULL`,
    [readerIds, cashierUserId],
  );
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
