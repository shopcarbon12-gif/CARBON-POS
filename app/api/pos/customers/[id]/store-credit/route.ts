import { NextResponse } from "next/server";
import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  /** Positive = grant credit; negative = redeem/deduct credit. */
  delta: z.number().refine((n) => Math.abs(n) > 0, "delta must be non-zero"),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/pos/customers/:id/store-credit
 * Adjusts pos_customers.store_credit_balance by `delta`. The reason is
 * stored on the audit_log table when present. Refuses to take the balance
 * below zero so a manager can't accidentally over-redeem.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const cid = Number(id);
  if (!Number.isFinite(cid)) {
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
  const { delta, reason } = parsed.data;
  try {
    const result = await withTransaction(async (client) => {
      const cur = await client.query(
        `SELECT store_credit_balance::numeric AS balance
           FROM pos_customers WHERE id = $1 FOR UPDATE`,
        [cid],
      );
      if (cur.rows.length === 0) throw new Error("not_found");
      const next = Number(cur.rows[0].balance) + delta;
      if (next < 0) throw new Error("would_go_negative");
      const updated = await client.query(
        `UPDATE pos_customers
            SET store_credit_balance = $1
          WHERE id = $2
          RETURNING *`,
        [next, cid],
      );
      try {
        await client.query("SAVEPOINT audit");
        await client.query(
          `INSERT INTO audit_log (event_type, payload, created_at)
           VALUES ('pos_store_credit', $1::jsonb, now())`,
          [
            JSON.stringify({
              customer_id: cid,
              delta,
              reason: reason ?? null,
              new_balance: next,
              by_employee_id: cashier.employee_id,
            }),
          ],
        );
        await client.query("RELEASE SAVEPOINT audit");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT audit");
      }
      return updated.rows[0];
    });
    return NextResponse.json({ customer: result });
  } catch (err) {
    const m = (err as Error).message;
    if (m === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (m === "would_go_negative") {
      return NextResponse.json(
        {
          error: "negative_balance",
          message:
            "That would take store credit below $0. Adjust the amount and try again.",
        },
        { status: 400 },
      );
    }
    console.error("[store-credit]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
