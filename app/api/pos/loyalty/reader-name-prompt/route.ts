import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  first_name_seed: z.string().max(120).optional(),
  last_name_seed: z.string().max(120).optional(),
});

/**
 * Loyalty name prompt — sent when the cashier opens the name drawer and
 * clicks "Send to reader". The customer types their full name on the
 * BBPOS pin pad, then an optional email. Two-step collect_inputs call:
 *
 *   step 1: full name (required, single text input — Stripe Terminal's
 *           collect_inputs renders one value per screen, so we capture
 *           first/middle/last as a single string and split server-side
 *           in /reader-name-prompt/status)
 *   step 2: email (optional, skippable)
 *
 * POST   — kicks off the prompt
 * DELETE — cashier cancels (covered by /reader-prompt DELETE, which calls
 *          cancel_action on the reader — any in-flight collect_inputs is
 *          cancelled regardless of which kind it is)
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

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const readerId = await readerForCurrentSession(cashier.user_id);
  if (!readerId) {
    return NextResponse.json({ error: "no_reader" }, { status: 409 });
  }

  // Two-step collect_inputs: full name (required), email (optional).
  // Stripe Terminal renders one value per screen — we capture name as
  // a single string and split it server-side using the rule documented
  // in /reader-name-prompt/status (first / middle / last).
  const form = new URLSearchParams({
    "inputs[0][type]": "text",
    "inputs[0][required]": "true",
    "inputs[0][custom_text][title]": "⬢ CARBON REWARDS",
    "inputs[0][custom_text][description]":
      "Step 1 of 2 — your full name (first and last)",
    "inputs[0][custom_text][submit_button]": "Next",
    "inputs[1][type]": "email",
    "inputs[1][required]": "false",
    "inputs[1][custom_text][title]": "⬢ CARBON REWARDS",
    "inputs[1][custom_text][description]":
      "Step 2 of 2 — email for e-receipts + rewards updates (optional)",
    "inputs[1][custom_text][submit_button]": "Done",
    "inputs[1][custom_text][skip_button]": "Skip",
  });

  // Cancel anything that may be on the reader (phone prompt still active,
  // cart display, prior action).
  await stripeFetch(
    `/terminal/readers/${readerId}/cancel_action`,
    new URLSearchParams(),
  );

  const res = await stripeFetch(
    `/terminal/readers/${readerId}/collect_inputs`,
    form,
  );
  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(
      { error: "stripe_error", message: data.error?.message },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
