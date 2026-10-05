import { createHash, randomBytes } from "node:crypto";
import { getPool } from "@/lib/db";

/**
 * Server side of the store print relay (see migrations/017_print_agent.sql
 * and print-agent/README.md). Browsers queue ESC/POS bytes here; the
 * store's print agent claims them and writes them to the printer.
 */

/** Agent counts as online when it polled within this many seconds. */
export const AGENT_ONLINE_SECONDS = 45;

/** Queued jobs older than this are never printed (stale receipt). */
export const JOB_EXPIRE_SECONDS = 120;

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newAgentToken(): string {
  return `cpa_${randomBytes(24).toString("base64url")}`;
}

export type LocationPrintTarget = {
  pos_location_id: number;
  printer_host: string | null;
  printer_port: number;
  agent_online: boolean;
};

/** Printer + agent status for the store the cashier is signed in to. */
export async function locationPrintTarget(
  lid: string,
): Promise<LocationPrintTarget | null> {
  const r = await getPool().query(
    `SELECT id, printer_host, printer_port,
            (print_agent_token_hash IS NOT NULL
             AND print_agent_last_seen_at > now() - make_interval(secs => $2))
              AS agent_online
       FROM pos_locations
      WHERE wms_location_id = $1::uuid
      LIMIT 1`,
    [lid, AGENT_ONLINE_SECONDS],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    pos_location_id: row.id,
    printer_host: row.printer_host ?? null,
    printer_port: Number(row.printer_port ?? 9100),
    agent_online: Boolean(row.agent_online),
  };
}

export async function enqueuePrintJobs(
  posLocationId: number,
  payloads: Buffer[],
  userId: string | null,
): Promise<number[]> {
  const ids: number[] = [];
  for (const p of payloads) {
    const r = await getPool().query<{ id: string }>(
      `INSERT INTO pos_print_jobs (pos_location_id, payload, created_by)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [posLocationId, p, userId],
    );
    ids.push(Number(r.rows[0].id));
  }
  return ids;
}

/** Resolve the agent's Bearer key to its store, or null. */
export async function agentLocationFromRequest(
  req: Request,
): Promise<{ id: number; printer_host: string | null; printer_port: number } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return null;
  const r = await getPool().query(
    `SELECT id, printer_host, printer_port
       FROM pos_locations
      WHERE print_agent_token_hash = $1
      LIMIT 1`,
    [hashAgentToken(m[1])],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    printer_host: row.printer_host ?? null,
    printer_port: Number(row.printer_port ?? 9100),
  };
}
