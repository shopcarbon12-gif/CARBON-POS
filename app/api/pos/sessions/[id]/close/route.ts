import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const closeSchema = z.object({
  closing_cash_counted: z.number().nonnegative(),
});

/**
 * POST /api/pos/sessions/:id/close
 *
 * Closes a register session. Computes:
 *   expected_cash = opening_cash
 *                 + sum(cash payments collected during the session)
 *                 + sum(cash adds)      (cash *in* during shift)
 *                 - sum(cash drops)
 *                 - sum(cash payouts)   (payouts are cash leaving — subtract)
 *   cash_over_short = closing_cash_counted - expected_cash
 *
 * Wrapped in a transaction so the math and the status flip happen together.
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
  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const closed = await withTransaction(async (client) => {
      const sessionRes = await client.query(
        `SELECT * FROM pos_register_sessions
          WHERE id = $1 AND status = 'open'
          FOR UPDATE`,
        [sessionId],
      );
      const session = sessionRes.rows[0];
      if (!session) throw new Error("session_not_open");

      const cashRes = await client.query(
        `SELECT COALESCE(SUM(p.amount), 0) AS cash_taken
           FROM pos_payments p
           JOIN pos_sales s ON s.id = p.sale_id
          WHERE s.register_id = $1
            AND s.created_at >= $2
            AND p.method = 'cash'
            AND p.status = 'completed'`,
        [session.register_id, session.opened_at],
      );
      const dropRes = await client.query(
        `SELECT
            COALESCE(SUM(CASE WHEN type = 'drop'   THEN amount ELSE 0 END), 0) AS drops,
            COALESCE(SUM(CASE WHEN type = 'payout' THEN amount ELSE 0 END), 0) AS payouts,
            COALESCE(SUM(CASE WHEN type = 'add'    THEN amount ELSE 0 END), 0) AS adds
           FROM pos_cash_movements
          WHERE register_session_id = $1`,
        [sessionId],
      );

      const opening = Number(session.opening_cash);
      const cashTaken = Number(cashRes.rows[0].cash_taken);
      const drops = Number(dropRes.rows[0].drops);
      const payouts = Number(dropRes.rows[0].payouts);
      const adds = Number(dropRes.rows[0].adds);
      const expected = opening + cashTaken + adds - drops - payouts;
      const counted = parsed.data.closing_cash_counted;
      const overShort = Number((counted - expected).toFixed(2));

      const updateRes = await client.query(
        `UPDATE pos_register_sessions
            SET status = 'closed',
                closed_by = $1,
                closed_at = now(),
                closing_cash_counted = $2,
                expected_cash = $3,
                cash_over_short = $4
          WHERE id = $5
          RETURNING *`,
        [cashier.user_id, counted, expected.toFixed(2), overShort, sessionId],
      );
      return updateRes.rows[0];
    });
    return NextResponse.json({ session: closed });
  } catch (err: unknown) {
    if ((err as Error).message === "session_not_open") {
      return NextResponse.json(
        { error: "not_open", message: "This register is already closed." },
        { status: 409 },
      );
    }
    console.error("[sessions/close]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// Force-import getPool so tree-shakers don't drop it (used by the helper).
void getPool;
