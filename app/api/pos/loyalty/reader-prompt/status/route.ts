import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/loyalty/reader-prompt/status
 *
 * Polled by the sell screen after kicking off the phone prompt. Reads the
 * reader's current action via Stripe and returns:
 *   { status: "pending" }                 — customer is still entering
 *   { status: "succeeded", phone: "..." } — customer submitted
 *   { status: "canceled" }                — cashier or Stripe cancelled
 *   { status: "failed", message }         — reader timed out / errored
 *   { status: "idle" }                    — no active action (e.g. after
 *                                            we just cancelled, before
 *                                            cart-mirror takes over)
 */
async function readerForCurrentSession(userId: string): Promise<string | null> {
  const r = await getPool().query(
    `SELECT reg.stripe_reader_id
       FROM pos_register_sessions s
       JOIN pos_registers reg ON reg.id = s.register_id
      WHERE s.status = 'open' AND s.opened_by = $1
      ORDER BY s.opened_at DESC LIMIT 1`,
    [userId],
  );
  return r.rows[0]?.stripe_reader_id ?? null;
}

export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const readerId = await readerForCurrentSession(cashier.user_id);
  if (!readerId) {
    return NextResponse.json({ error: "no_reader" }, { status: 409 });
  }

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const res = await fetch(`https://api.stripe.com/v1/terminal/readers/${readerId}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
    },
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: "stripe_error", message: j.error?.message },
      { status: 502 },
    );
  }
  const reader = await res.json();
  const action = reader.action;

  if (!action) {
    return NextResponse.json({ status: "idle" });
  }
  if (action.type !== "collect_inputs") {
    // Reader is doing something else (cart display, payment). Treat as
    // "no prompt in flight" — caller will stop polling.
    return NextResponse.json({ status: "idle", other_action: action.type });
  }

  if (action.status === "in_progress") {
    return NextResponse.json({ status: "pending" });
  }
  if (action.status === "failed") {
    return NextResponse.json({
      status: "failed",
      message: action.failure_message ?? "Reader action failed.",
    });
  }
  if (action.status === "canceled") {
    return NextResponse.json({ status: "canceled" });
  }

  // succeeded
  const inputs = action.collect_inputs?.inputs ?? [];
  const numericInput = inputs.find(
    (i: { type?: string; numeric?: { value?: string }; skipped?: boolean }) =>
      i.type === "numeric",
  );
  const phone = numericInput?.numeric?.value;
  if (numericInput?.skipped || !phone) {
    return NextResponse.json({ status: "canceled" });
  }
  return NextResponse.json({ status: "succeeded", phone });
}
