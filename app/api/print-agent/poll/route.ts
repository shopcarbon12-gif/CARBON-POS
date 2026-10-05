import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { agentLocationFromRequest, JOB_EXPIRE_SECONDS } from "@/lib/print-queue";

export const dynamic = "force-dynamic";

/** How long one poll waits for a job before returning empty. */
const LONG_POLL_MS = 20_000;
const CHECK_EVERY_MS = 400;

/**
 * POST /api/print-agent/poll   (Authorization: Bearer <agent key>)
 * Body: { info?: string }  — hostname/version, shown in Settings.
 *
 * Long-poll: returns as soon as there are jobs for the agent's store
 * (claimed atomically, status → 'sending'), or { jobs: [] } after ~20 s.
 * Each job carries the printer host/port configured in Settings, so the
 * agent itself needs no printer config.
 */
export async function POST(req: Request) {
  const loc = await agentLocationFromRequest(req);
  if (!loc) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { info?: unknown };
  const info = typeof body.info === "string" ? body.info.slice(0, 200) : null;
  const pool = getPool();

  await pool.query(
    `UPDATE pos_locations
        SET print_agent_last_seen_at = now(),
            print_agent_info = COALESCE($2, print_agent_info)
      WHERE id = $1`,
    [loc.id, info],
  );
  // Housekeeping: never print stale receipts, keep a week of history.
  await pool.query(
    `UPDATE pos_print_jobs
        SET status = 'expired', finished_at = now()
      WHERE pos_location_id = $1 AND status = 'queued'
        AND created_at < now() - make_interval(secs => $2)`,
    [loc.id, JOB_EXPIRE_SECONDS],
  );
  await pool.query(
    `DELETE FROM pos_print_jobs
      WHERE pos_location_id = $1 AND created_at < now() - interval '7 days'`,
    [loc.id],
  );

  const deadline = Date.now() + LONG_POLL_MS;
  while (!req.signal.aborted) {
    const r = await pool.query(
      `UPDATE pos_print_jobs j
          SET status = 'sending', claimed_at = now(), attempts = j.attempts + 1
        WHERE j.id IN (
          SELECT id FROM pos_print_jobs
           WHERE pos_location_id = $1
             AND created_at > now() - make_interval(secs => $2)
             AND (status = 'queued'
                  OR (status = 'sending' AND attempts < 3
                      AND claimed_at < now() - interval '30 seconds'))
           ORDER BY id
           LIMIT 5
           FOR UPDATE SKIP LOCKED)
        RETURNING j.id, encode(j.payload, 'hex') AS hex`,
      [loc.id, JOB_EXPIRE_SECONDS],
    );
    if (r.rows.length > 0) {
      const jobs = r.rows
        .map((j) => ({
          id: Number(j.id),
          host: loc.printer_host,
          port: loc.printer_port,
          hex: j.hex as string,
        }))
        .sort((a, b) => a.id - b.id);
      return NextResponse.json({ jobs });
    }
    if (Date.now() >= deadline) break;
    await new Promise((res) => setTimeout(res, CHECK_EVERY_MS));
  }
  return NextResponse.json({ jobs: [] });
}
