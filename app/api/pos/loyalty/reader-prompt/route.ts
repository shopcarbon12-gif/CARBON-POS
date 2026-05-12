import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * Loyalty phone prompt on the BBPOS WisePOS E.
 *
 * POST   — kicks off Stripe Terminal collect_inputs on the cashier's
 *          current register's reader. The customer enters their phone on
 *          the reader; the cashier polls /status to read the result.
 * DELETE — cashier-side "Skip" button. Cancels the reader action so the
 *          cart-mirror can take over.
 *
 * Stripe's Node SDK (v17) doesn't expose collect_inputs as a typed method
 * yet, so we call the REST endpoint directly.
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

async function stripeFetch(path: string, body?: URLSearchParams, method = "POST") {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  return fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body?.toString(),
  });
}

export async function POST() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const readerId = await readerForCurrentSession(cashier.user_id);
  if (!readerId) {
    return NextResponse.json({ error: "no_reader" }, { status: 409 });
  }

  // Using `numeric` instead of `phone` to bypass the reader's overly
  // strict libphonenumber validation (which rejects valid US numbers
  // with newer area codes like 689). We validate format on our side.
  const form = new URLSearchParams({
    "inputs[0][type]": "numeric",
    "inputs[0][required]": "true",
    "inputs[0][custom_text][title]": "⬢ CARBON REWARDS",
    "inputs[0][custom_text][description]":
      "Enter your phone number to earn points on this purchase.",
    "inputs[0][custom_text][submit_button]": "Continue",
  });

  const res = await stripeFetch(
    `/terminal/readers/${readerId}/collect_inputs`,
    form,
  );
  const data = await res.json();
  if (!res.ok) {
    // Reader is mid-action (cart display, prior payment), or offline.
    // Try to cancel and retry once.
    if (data.error?.code === "terminal_reader_busy") {
      await stripeFetch(
        `/terminal/readers/${readerId}/cancel_action`,
        new URLSearchParams(),
      );
      const retry = await stripeFetch(
        `/terminal/readers/${readerId}/collect_inputs`,
        form,
      );
      const retryData = await retry.json();
      if (!retry.ok) {
        return NextResponse.json(
          { error: "reader_busy", message: retryData.error?.message },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: "stripe_error", message: data.error?.message },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const readerId = await readerForCurrentSession(cashier.user_id);
  if (!readerId) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  const res = await stripeFetch(
    `/terminal/readers/${readerId}/cancel_action`,
    new URLSearchParams(),
  );
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    // "no_action" means reader was already idle — treat as success.
    if (j.error?.code === "no_action") {
      return NextResponse.json({ ok: true, was_idle: true });
    }
    return NextResponse.json({ ok: false, message: j.error?.message });
  }
  return NextResponse.json({ ok: true });
}
