import { getPool } from "@/lib/db";

/**
 * Reader-control helpers — scoped to the cashier's POS-dedicated reader
 * ONLY. The CDM supervisor's spawn gate has two flags:
 *
 *   • cdm_agents.live_scan_active     (per-AGENT — affects every reader
 *                                       attached to the agent)
 *   • devices.scan_paused_at IS NULL  (per-READER — what Hardware
 *                                       Config's Start/Stop button uses)
 *
 * POS must NEVER touch live_scan_active. The orlando-cdm agent serves
 * 14 warehouse readers in addition to the POS .69 reader; flipping its
 * tenant-wide flag would silently stop every Aisle / Office / Transfer
 * Bin reader every time a cashier opens or closes the sell screen.
 *
 * Instead POS only flips scan_paused_at on the reader marked
 * is_pos_dedicated = TRUE. The agent stays untouched, the warehouse
 * keeps scanning, and only the .69 reader follows the sell-screen
 * lifecycle.
 */

export type PosReaderInfo = {
  reader_id: string;
  agent_id: string;
  status_online: boolean;
  scan_paused: boolean;
  agent_live_scan_active: boolean;
};

/**
 * Resolve the POS reader for the cashier's currently-open register.
 * Returns null when the cashier has no open session, the register has
 * no agent linked, or the agent has no `is_pos_dedicated=true` reader.
 */
export async function posReaderForCurrentSession(
  userId: string,
): Promise<PosReaderInfo | null> {
  const r = await getPool().query<PosReaderInfo>(
    `SELECT d.id::text                              AS reader_id,
            ag.id::text                             AS agent_id,
            d.status_online                         AS status_online,
            (d.scan_paused_at IS NOT NULL)          AS scan_paused,
            ag.live_scan_active                     AS agent_live_scan_active
       FROM pos_register_sessions s
       JOIN pos_registers reg ON reg.id = s.register_id
       JOIN cdm_agents ag      ON ag.id = reg.cdm_agent_id
       JOIN devices d          ON d.cdm_agent_id = ag.id
                              AND d.device_type IN
                                  ('fixed_reader','transaction_reader','door_reader')
                              AND d.is_pos_dedicated = TRUE
      WHERE s.status = 'open' AND s.opened_by = $1
      ORDER BY s.opened_at DESC
      LIMIT 1`,
    [userId],
  );
  return r.rows[0] ?? null;
}

/**
 * Clear the per-reader pause flag on the POS-dedicated reader ONLY.
 * Direct DB write so non-admin cashiers don't need elevated WMS scope
 * to call /api/hardware-config/readers/{id}/resume. Mirrors that
 * endpoint's logic 1:1 for the single is_pos_dedicated row.
 */
export async function clearPosReaderPause(readerId: string): Promise<void> {
  await getPool().query(
    `UPDATE devices
        SET scan_paused_at = NULL,
            scan_paused_by = NULL,
            updated_at     = now()
      WHERE id              = $1::uuid
        AND is_pos_dedicated = TRUE`,
    [readerId],
  );
}

/** Symmetric: pause ONLY the POS-dedicated reader. */
export async function setPosReaderPause(
  readerId: string,
  cashierUserId: string,
): Promise<void> {
  await getPool().query(
    `UPDATE devices
        SET scan_paused_at = now(),
            scan_paused_by = $2::uuid,
            updated_at     = now()
      WHERE id              = $1::uuid
        AND is_pos_dedicated = TRUE
        AND scan_paused_at IS NULL`,
    [readerId, cashierUserId],
  );
}

/**
 * Asymmetric wake: flip cdm_agents.live_scan_active to TRUE on the
 * named agent if it isn't already, so the supervisor will spawn
 * reader binaries. POS only CALLS this on Start — never the reverse.
 * The matching "stop" path leaves the agent flag alone so warehouse
 * readers keep running after a POS session ends.
 *
 * It's idempotent: if the warehouse already had the agent on, this
 * is a no-op. If POS is the first thing to wake the agent for the
 * day, the warehouse readers come up alongside POS — which is the
 * intended state for normal operation anyway.
 */
export async function wakeAgentIfDormant(
  agentId: string,
  cashierUserId: string,
): Promise<void> {
  await getPool().query(
    `UPDATE cdm_agents
        SET live_scan_active           = TRUE,
            live_scan_last_started_at  = now(),
            live_scan_started_by       = $2::uuid,
            updated_at                 = now()
      WHERE id                  = $1::uuid
        AND live_scan_active   IS DISTINCT FROM TRUE`,
    [agentId, cashierUserId],
  );
}
