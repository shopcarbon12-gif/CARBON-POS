import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  type: z.enum(["drop", "payout"]),
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/pos/sessions/:id/cash-movement
 * Logs a cash drop (to safe/bank) or a payout (cash out for petty cash, etc).
 * The drop/payout amount is reflected in the expected_cash math at close.
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const pool = getPool();
  // Confirm the session is open before allowing a movement.
  const sessionRes = await pool.query(
    `SELECT id FROM pos_register_sessions WHERE id = $1 AND status = 'open'`,
    [sessionId],
  );
  if (!sessionRes.rows[0]) {
    return NextResponse.json(
      { error: "not_open", message: "That register session isn't open." },
      { status: 409 },
    );
  }
  const ins = await pool.query(
    `INSERT INTO pos_cash_movements (register_session_id, type, amount, reason, done_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      sessionId,
      parsed.data.type,
      parsed.data.amount,
      parsed.data.reason ?? null,
      cashier.user_id,
    ],
  );
  return NextResponse.json({ movement: ins.rows[0] });
}
