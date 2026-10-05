import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { enqueuePrintJobs, locationPrintTarget } from "@/lib/print-queue";

const postSchema = z.object({
  // Each entry is one cut ticket of raw ESC/POS bytes, hex-encoded.
  jobs: z.array(z.string().regex(/^[0-9a-fA-F]*$/).min(2)).min(1).max(10),
});

/**
 * POST /api/pos/print-jobs
 * Queue print jobs for the store's print agent. When the store has no
 * agent online, returns { mode: "direct", host } and the browser prints
 * straight to the printer (ePOS-Print) as before.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const target = await locationPrintTarget(cashier.lid);
  if (!target) {
    return NextResponse.json({ error: "no_location" }, { status: 404 });
  }
  if (!target.agent_online) {
    return NextResponse.json({ mode: "direct", host: target.printer_host });
  }
  if (!target.printer_host) {
    return NextResponse.json(
      {
        error: "no_printer",
        message:
          "No receipt printer is configured for this location. Set it in Settings → Locations → printer host/port.",
      },
      { status: 409 },
    );
  }
  const ids = await enqueuePrintJobs(
    target.pos_location_id,
    parsed.data.jobs.map((h) => Buffer.from(h, "hex")),
    cashier.user_id,
  );
  return NextResponse.json({ mode: "agent", ids });
}

/**
 * GET /api/pos/print-jobs?ids=1,2
 * Status of queued jobs (only this store's) so the screen can show
 * "Printed ✓" or the agent's error.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 20);
  if (ids.length === 0) return NextResponse.json({ jobs: [] });
  const r = await getPool().query(
    `SELECT j.id, j.status, j.error
       FROM pos_print_jobs j
       JOIN pos_locations pl ON pl.id = j.pos_location_id
      WHERE j.id = ANY($1::bigint[])
        AND pl.wms_location_id = $2::uuid`,
    [ids, cashier.lid],
  );
  return NextResponse.json({
    jobs: r.rows.map((j) => ({ id: Number(j.id), status: j.status, error: j.error })),
  });
}
