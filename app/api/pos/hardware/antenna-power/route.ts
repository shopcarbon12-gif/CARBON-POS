import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const patchSchema = z.object({
  // Impinj-class readers cap around 31.5 dBm; 10 is the practical floor.
  power_dbm: z.number().int().min(10).max(31),
});

/**
 * Antenna transmit-power control for the cashier's register reader.
 *
 * GET   — returns the current power dBm reported by every antenna under
 *         the cashier's register's reader. The slider shows the value;
 *         when antennas disagree, the lower one wins (safest default).
 * PATCH — sets devices.config.transmit_power_dbm AND
 *         devices.suggested_power_dbm on every antenna of the reader.
 *         The CDM agent reads transmit_power_dbm on its next config poll
 *         (~3 s) and re-spawns the reader binary with the new value.
 *
 * Auto-sweep caveat: the WMS supervisor sweeps to find a working power
 * only when the chip wedges (chassis_wedged_at). Under normal operation
 * the manual value persists; if a sweep does fire it'll write a new
 * suggested_power_dbm but the auto-apply only runs when the reader is
 * silent — so a productive cashier setting won't get clobbered.
 */
async function antennasForCurrentRegister(userId: string): Promise<{
  reader_id: string;
  antenna_ids: string[];
} | null> {
  const r = await getPool().query<{ reader_id: string; antenna_id: string }>(
    `SELECT a.parent_device_id AS reader_id, a.id AS antenna_id
       FROM pos_register_sessions s
       JOIN pos_registers reg ON reg.id = s.register_id
       JOIN cdm_agents ag      ON ag.id = reg.cdm_agent_id
       JOIN devices reader     ON reader.cdm_agent_id = ag.id
                              AND reader.device_type = 'fixed_reader'
       JOIN devices a          ON a.parent_device_id = reader.id
                              AND a.device_type = 'antenna'
      WHERE s.status = 'open' AND s.opened_by = $1`,
    [userId],
  );
  if (r.rowCount === 0) return null;
  return {
    reader_id: r.rows[0].reader_id,
    antenna_ids: r.rows.map((row) => row.antenna_id),
  };
}

export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const linked = await antennasForCurrentRegister(cashier.user_id);
  if (!linked) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_antenna" });
  }
  const r = await getPool().query<{
    id: string;
    name: string;
    suggested_power_dbm: number | null;
    transmit_power_dbm: number | null;
    status_online: boolean;
  }>(
    `SELECT id, name, suggested_power_dbm,
            (config->>'transmit_power_dbm')::int AS transmit_power_dbm,
            status_online
       FROM devices
      WHERE id = ANY($1::uuid[])`,
    [linked.antenna_ids],
  );
  // The active value: prefer the configured one, fall back to suggested,
  // then a safe default. If antennas disagree, lower wins.
  const values = r.rows
    .map((a) => a.transmit_power_dbm ?? a.suggested_power_dbm)
    .filter((v): v is number => v !== null);
  const power_dbm = values.length > 0 ? Math.min(...values) : 25;
  return NextResponse.json({
    ok: true,
    reader_id: linked.reader_id,
    antenna_ids: linked.antenna_ids,
    power_dbm,
    min: 10,
    max: 31,
  });
}

export async function PATCH(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const linked = await antennasForCurrentRegister(cashier.user_id);
  if (!linked) {
    return NextResponse.json({ error: "no_antenna" }, { status: 409 });
  }
  const power = parsed.data.power_dbm;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 1. Write the new power to every antenna.
    await client.query(
      `UPDATE devices
          SET suggested_power_dbm    = $1::int,
              suggested_power_dbm_at = now(),
              config = jsonb_set(
                COALESCE(config, '{}'::jsonb),
                '{transmit_power_dbm}',
                to_jsonb($1::int)
              ),
              updated_at = now()
        WHERE id = ANY($2::uuid[])`,
      [power, linked.antenna_ids],
    );
    // 2. Stamp the parent reader to force a binary respawn — power is
    //    read at spawn time by the CDM supervisor, NOT hot-reloaded.
    //    Without this, the DB shows 11 dBm but the live reader binary
    //    keeps scanning at whatever it had when it last spawned.
    await client.query(
      `UPDATE devices
          SET reader_recover_requested_at = now(),
              updated_at = now()
        WHERE id = $1::uuid`,
      [linked.reader_id],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[antenna-power PATCH]", err);
    return NextResponse.json(
      { error: "write_failed", message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    client.release();
  }
  return NextResponse.json({
    ok: true,
    power_dbm: power,
    // The cashier should expect a ~3-5 s lag before reads slow down —
    // the agent has to see the recover request, kill the binary, and
    // respawn at the new power.
    respawn_lag_seconds: 5,
  });
}
