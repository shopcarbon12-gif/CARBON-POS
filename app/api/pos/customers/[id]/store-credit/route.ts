import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { getPool, withTransaction } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { isStoreCreditApprover } from "@/lib/store-credit";

const schema = z.object({
  /** Positive = grant credit; negative = redeem/deduct credit.
   *  Required for the approver; for everyone else the amount comes from the
   *  approved request, so it's optional here. */
  delta: z
    .number()
    .refine((n) => Math.abs(n) > 0, "delta must be non-zero")
    .optional(),
  reason: z.string().max(500).optional(),
  /** Non-approver path: the approval issued by request-approval + its code. */
  approval_id: z.number().int().positive().optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
});

const MAX_CODE_ATTEMPTS = 5;

function hashCode(code: string, customerId: number, delta: number): string {
  return createHash("sha256")
    .update(`${code}|${customerId}|${delta.toFixed(2)}`)
    .digest("hex");
}

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
  const isApprover = isStoreCreditApprover(cashier.email);
  const { delta: rawDelta, reason: rawReason, approval_id, code } = parsed.data;
  const pool = getPool();

  // Resolve the amount + reason to apply. The approver adjusts directly with
  // the amount they typed; everyone else can only apply an amount that was
  // approved via an emailed code, and we verify that code here.
  let effectiveDelta: number;
  let effectiveReason: string | null;

  if (isApprover) {
    if (rawDelta === undefined) {
      return NextResponse.json(
        { error: "invalid_request", message: "Enter an amount." },
        { status: 400 },
      );
    }
    effectiveDelta = rawDelta;
    effectiveReason = rawReason ?? null;
  } else {
    if (!approval_id || !code) {
      return NextResponse.json(
        {
          error: "approval_required",
          message: "Store-credit changes need an emailed approval code.",
        },
        { status: 403 },
      );
    }
    const ap = await pool.query<{
      delta: string;
      reason: string | null;
      code_hash: string;
      attempts: number;
      consumed_at: string | null;
      expires_at: string;
    }>(
      `SELECT delta::numeric AS delta, reason, code_hash, attempts,
              consumed_at, expires_at
         FROM pos_store_credit_approvals
        WHERE id = $1 AND customer_id = $2`,
      [approval_id, cid],
    );
    const row = ap.rows[0];
    if (!row) {
      return NextResponse.json(
        { error: "approval_not_found", message: "That approval wasn't found. Request a new code." },
        { status: 400 },
      );
    }
    if (row.consumed_at) {
      return NextResponse.json(
        { error: "approval_used", message: "That code was already used. Request a new one." },
        { status: 400 },
      );
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "approval_expired", message: "That code expired. Request a new one." },
        { status: 400 },
      );
    }
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      return NextResponse.json(
        { error: "approval_locked", message: "Too many wrong attempts. Request a new code." },
        { status: 400 },
      );
    }
    const approvedDelta = Number(row.delta);
    if (hashCode(code, cid, approvedDelta) !== row.code_hash) {
      await pool.query(
        `UPDATE pos_store_credit_approvals SET attempts = attempts + 1 WHERE id = $1`,
        [approval_id],
      );
      const left = MAX_CODE_ATTEMPTS - (row.attempts + 1);
      return NextResponse.json(
        {
          error: "bad_code",
          message:
            left > 0
              ? `That code is incorrect. ${left} attempt${left === 1 ? "" : "s"} left.`
              : "That code is incorrect. Request a new code.",
        },
        { status: 400 },
      );
    }
    effectiveDelta = approvedDelta;
    effectiveReason = row.reason;
  }

  try {
    const result = await withTransaction(async (client) => {
      // Atomically consume the approval so a single code can't be replayed
      // by two concurrent requests.
      if (!isApprover) {
        const consumed = await client.query(
          `UPDATE pos_store_credit_approvals
              SET consumed_at = now()
            WHERE id = $1 AND consumed_at IS NULL
            RETURNING id`,
          [approval_id],
        );
        if (consumed.rowCount === 0) throw new Error("approval_used");
      }
      const cur = await client.query(
        `SELECT store_credit_balance::numeric AS balance
           FROM pos_customers WHERE id = $1 FOR UPDATE`,
        [cid],
      );
      if (cur.rows.length === 0) throw new Error("not_found");
      const next = Number(cur.rows[0].balance) + effectiveDelta;
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
              delta: effectiveDelta,
              reason: effectiveReason,
              new_balance: next,
              by_employee_id: cashier.employee_id,
              approval_id: isApprover ? null : approval_id,
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
    if (m === "approval_used") {
      return NextResponse.json(
        { error: "approval_used", message: "That code was already used. Request a new one." },
        { status: 400 },
      );
    }
    console.error("[store-credit]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
