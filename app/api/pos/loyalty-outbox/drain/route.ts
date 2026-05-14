import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

/**
 * POST /api/pos/loyalty-outbox/drain
 *
 * Drains pos_loyalty_outbox by POSTing each pending row to the loyalty
 * service. Idempotency keys mean retries are safe.
 *
 * Auth: gated on a shared bearer (LOYALTY_OUTBOX_DRAIN_KEY env). A
 * Coolify cron job hits this every minute. If it ever doesn't run for
 * a while, the rows stay queued — the next drain catches them up.
 */
const LOYALTY_BASE = process.env.LOYALTY_API_BASE_URL?.trim() || "https://rewards.shopcarbon.com";
const LOYALTY_KEY = process.env.LOYALTY_API_KEY?.trim() || "";
const DRAIN_KEY = process.env.LOYALTY_OUTBOX_DRAIN_KEY?.trim() || "";

const BATCH = 50;
const MAX_ATTEMPTS = 8;

export async function POST(req: Request) {
  if (!DRAIN_KEY) {
    return NextResponse.json({ error: "drain_key_missing" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${DRAIN_KEY}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!LOYALTY_KEY) {
    return NextResponse.json({ error: "loyalty_key_missing" }, { status: 503 });
  }
  const pool = getPool();
  const r = await pool.query<{
    id: string;
    endpoint: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>(
    `SELECT id::text, endpoint, payload, attempts
       FROM pos_loyalty_outbox
      WHERE posted_at IS NULL
        AND attempts < $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [MAX_ATTEMPTS, BATCH],
  );
  let posted = 0;
  let failed = 0;
  for (const row of r.rows) {
    try {
      const res = await fetch(`${LOYALTY_BASE}${row.endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOYALTY_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(row.payload),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        await pool.query(
          `UPDATE pos_loyalty_outbox
              SET posted_at = now(), attempts = attempts + 1, last_attempt_at = now()
            WHERE id = $1`,
          [row.id],
        );
        posted++;
      } else {
        const text = await res.text().catch(() => "");
        await pool.query(
          `UPDATE pos_loyalty_outbox
              SET attempts = attempts + 1,
                  last_attempt_at = now(),
                  last_error = $2
            WHERE id = $1`,
          [row.id, `http_${res.status}: ${text.slice(0, 200)}`],
        );
        failed++;
      }
    } catch (err) {
      await pool.query(
        `UPDATE pos_loyalty_outbox
            SET attempts = attempts + 1,
                last_attempt_at = now(),
                last_error = $2
          WHERE id = $1`,
        [row.id, (err as Error).message.slice(0, 200)],
      );
      failed++;
    }
  }
  return NextResponse.json({ posted, failed, scanned: r.rowCount });
}
