import { NextResponse } from "next/server";
import { z } from "zod";
import { randomInt, createHash } from "node:crypto";
import { Resend } from "resend";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import {
  storeCreditApproverEmail,
  isStoreCreditApprover,
} from "@/lib/store-credit";

const schema = z.object({
  delta: z.number().refine((n) => Math.abs(n) > 0, "delta must be non-zero"),
  reason: z.string().max(500).optional(),
});

/** Bind the code to (customer, amount) so an approval can only ever apply
 *  the exact amount it was issued for. */
function hashCode(code: string, customerId: number, delta: number): string {
  return createHash("sha256")
    .update(`${code}|${customerId}|${delta.toFixed(2)}`)
    .digest("hex");
}

/**
 * POST /api/pos/customers/:id/store-credit/request-approval
 *
 * For non-approver staff: generate a 6-digit code, store it (hashed, bound to
 * the customer + amount, 15-min expiry) and email it to the store-credit
 * approver. The actual adjustment is applied by POST .../store-credit once the
 * code is entered.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // The approver never needs a code — they adjust directly.
  if (isStoreCreditApprover(cashier.email)) {
    return NextResponse.json(
      { error: "not_required", message: "You can adjust store credit directly." },
      { status: 400 },
    );
  }
  const { id } = await ctx.params;
  const cid = Number(id);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { delta, reason } = parsed.data;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "email_not_configured", message: "Email isn't set up yet." },
      { status: 503 },
    );
  }

  const pool = getPool();
  const cust = await pool.query<{ first_name: string; last_name: string | null }>(
    `SELECT first_name, last_name FROM pos_customers WHERE id = $1`,
    [cid],
  );
  if (cust.rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const customerName =
    [cust.rows[0].first_name, cust.rows[0].last_name].filter(Boolean).join(" ") ||
    `Customer #${cid}`;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const approver = storeCreditApproverEmail();
  const ins = await pool.query<{ id: number }>(
    `INSERT INTO pos_store_credit_approvals
       (customer_id, delta, reason, code_hash,
        requested_by_employee_id, requested_by_email, sent_to, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '15 minutes')
     RETURNING id`,
    [
      cid,
      delta,
      reason ?? null,
      hashCode(code, cid, delta),
      cashier.employee_id,
      cashier.email,
      approver,
    ],
  );

  const action = delta >= 0 ? "GRANT" : "DEDUCT";
  const amount = formatMoney(Math.abs(delta));
  const html = `
    <h2>Store-credit approval request</h2>
    <p><b>${cashier.email ?? "A staff member"}</b> is requesting to
       <b>${action} ${amount}</b> of store credit
       ${delta >= 0 ? "to" : "from"} <b>${escapeHtml(customerName)}</b>
       (customer #${cid}).</p>
    ${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ""}
    <p>Approval code:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
    <p>Give this code to the requester to authorize <b>this exact amount only</b>.
       It expires in 15 minutes. If you didn't expect this request, ignore this
       email and the change will not be applied.</p>
  `;
  const resend = new Resend(apiKey);
  try {
    await resend.emails.send({
      from: process.env.RECEIPT_FROM_EMAIL || "receipts@shopcarbon.com",
      to: approver,
      subject: `Store-credit approval: ${action} ${amount} — ${customerName}`,
      html,
    });
  } catch (err) {
    console.error("[store-credit/request-approval] email", err);
    // Roll the pending approval back so a failed send doesn't leave a dangling
    // code the approver never received.
    await pool.query(`DELETE FROM pos_store_credit_approvals WHERE id = $1`, [
      ins.rows[0].id,
    ]);
    return NextResponse.json(
      { error: "send_failed", message: "Couldn't email the approval code. Try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    approval_id: ins.rows[0].id,
    sent_to: approver,
    expires_in_minutes: 15,
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}
