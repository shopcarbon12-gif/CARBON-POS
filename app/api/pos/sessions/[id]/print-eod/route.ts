import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { printRegisterCloseEod } from "@/lib/thermal-printer";

const rowSchema = z.object({
  label: z.string(),
  calculated: z.number(),
  counted: z.number(),
  over_short: z.number(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema),
  note: z.string().nullable().optional(),
});

/**
 * POST /api/pos/sessions/:id/print-eod
 * Prints the End-of-Day report for a closed session. The client passes the
 * Calc/Counted/+/- rows it just rendered on the summary page so the paper
 * matches exactly what the cashier saw.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.opened_at,
            s.closed_at,
            u.email AS closed_by_name,
            l.name  AS location_name,
            r.name  AS register_name
       FROM pos_register_sessions s
       JOIN pos_registers   r  ON r.id = s.register_id
       JOIN pos_locations   pl ON pl.id = r.pos_location_id
       JOIN locations       l  ON l.id = pl.wms_location_id
       LEFT JOIN users      u  ON u.id = s.closed_by
      WHERE s.id = $1
      LIMIT 1`,
    [sessionId],
  );
  const session = r.rows[0];
  if (!session) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const totalCalc = parsed.data.rows.reduce((s, x) => s + x.calculated, 0);
  const totalCounted = parsed.data.rows.reduce((s, x) => s + x.counted, 0);
  const totalOverShort = parsed.data.rows.reduce((s, x) => s + x.over_short, 0);

  try {
    const result = await printRegisterCloseEod({
      opened_at: session.opened_at,
      closed_at: session.closed_at ?? new Date().toISOString(),
      closed_by_name: session.closed_by_name ?? cashier.email,
      location_name: session.location_name,
      register_name: session.register_name,
      rows: parsed.data.rows.map((x) => ({
        label: x.label,
        calculated: String(x.calculated),
        counted: String(x.counted),
        over_short: String(x.over_short),
      })),
      total_calculated: String(totalCalc),
      total_counted: String(totalCounted),
      total_over_short: String(totalOverShort),
      note: parsed.data.note ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[sessions/print-eod]", err);
    return NextResponse.json(
      {
        error: "printer_failed",
        message: "Couldn't reach the receipt printer.",
      },
      { status: 502 },
    );
  }
}
