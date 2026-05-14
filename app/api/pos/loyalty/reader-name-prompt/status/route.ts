import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/loyalty/reader-name-prompt/status
 *
 * Polls the reader's current action and returns the name + email
 * collected from the customer's pin pad. The pin pad captures the full
 * name as a single string (Stripe Terminal's collect_inputs renders
 * one value per screen) which we split with this rule:
 *
 *   1 word  → first_name=word[0],                last_name=""
 *   2 words → first_name=word[0],                last_name=word[1]
 *   3 words → first_name="word[0] word[1]",      last_name=word[2]
 *   4+ words → first_name="word[0] word[1]",     last_name=words[2..].join(" ")
 *
 * Rationale: word[1] is treated as a middle name on ≥3-word inputs and
 * folded into first_name (we don't store middle_name separately). The
 * tail (words 2..N) is the last name — this preserves compound last
 * names like "Van Halen" or "De La Cruz" when the customer also types
 * a middle name. Customers with compound last names + no middle should
 * be coached to type "Mary VanHalen" or use the inline form.
 *
 * Response shapes:
 *   { status: "pending" }
 *   { status: "succeeded", first_name, last_name, email }
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

  // succeeded — extract the two fields by type order (text=full name,
  // email=optional). The email step is skippable; if the customer
  // skipped, its `skipped` flag is true and value is null.
  type InputRow = {
    type?: string;
    skipped?: boolean;
    text?: { value?: string | null };
    email?: { value?: string | null };
  };
  const inputs = (action.collect_inputs?.inputs ?? []) as InputRow[];
  const nameRow = inputs.find((i) => i.type === "text");
  const fullName = nameRow?.skipped ? "" : (nameRow?.text?.value ?? "");
  const emailRow = inputs.find((i) => i.type === "email");
  const email = emailRow?.skipped ? null : (emailRow?.email?.value ?? null);
  if (!fullName.trim()) {
    return NextResponse.json({ status: "canceled" });
  }
  const { first_name, last_name } = splitFullName(fullName);
  if (!first_name) {
    return NextResponse.json({ status: "canceled" });
  }
  return NextResponse.json({
    status: "succeeded",
    first_name,
    last_name,
    email,
  });
}

/**
 * Split a single full-name string into first + last per the rule
 * documented at the top of this file. word[1] is treated as a middle
 * name on 3+ word inputs and folded into first_name (no middle column
 * in pos_customers); words 2..N become last_name to preserve compound
 * last names ("Van Halen", "De La Cruz") alongside the middle.
 */
function splitFullName(raw: string): { first_name: string; last_name: string } {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { first_name: "", last_name: "" };
  if (words.length === 1) return { first_name: words[0], last_name: "" };
  if (words.length === 2) return { first_name: words[0], last_name: words[1] };
  // 3+ words → first = "<first> <middle>", last = remaining words joined
  return {
    first_name: `${words[0]} ${words[1]}`,
    last_name: words.slice(2).join(" "),
  };
}
