import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/loyalty/reader-name-prompt/status
 *
 * Polls the reader's current action and returns the two text inputs
 * (first name, last name) collected from the customer's pin pad.
 *   { status: "pending" }
 *   { status: "succeeded", first_name, last_name }
 *   { status: "canceled" }
 *   { status: "failed", message }
 *   { status: "idle" }
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
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  if (!res.ok) {
    return NextResponse.json({ error: "stripe_error" }, { status: 502 });
  }
  const reader = await res.json();
  const action = reader.action;
  if (!action) return NextResponse.json({ status: "idle" });
  if (action.type !== "collect_inputs") {
    return NextResponse.json({ status: "idle", other_action: action.type });
  }
  if (action.status === "in_progress") return NextResponse.json({ status: "pending" });
  if (action.status === "failed") {
    return NextResponse.json({
      status: "failed",
      message: action.failure_message ?? "reader_failed",
    });
  }
  if (action.status === "canceled") return NextResponse.json({ status: "canceled" });

  // succeeded — extract the three fields by type order (text, text,
  // email). The email step is optional + skippable; if the customer
  // skipped, its `skipped` flag is true and value is null.
  type InputRow = {
    type?: string;
    skipped?: boolean;
    text?: { value?: string | null };
    email?: { value?: string | null };
  };
  const inputs = (action.collect_inputs?.inputs ?? []) as InputRow[];
  const texts = inputs
    .filter((i) => i.type === "text")
    .map((i) => (i.skipped ? "" : (i.text?.value ?? "")));
  const emailRow = inputs.find((i) => i.type === "email");
  const email = emailRow?.skipped ? null : (emailRow?.email?.value ?? null);
  if (texts.length < 2 || !texts[0].trim() || !texts[1].trim()) {
    return NextResponse.json({ status: "canceled" });
  }
  return NextResponse.json({
    status: "succeeded",
    first_name: texts[0],
    last_name: texts[1],
    email,
  });
}
