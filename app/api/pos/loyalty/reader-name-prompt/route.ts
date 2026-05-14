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
 * clicks "Send to reader". The customer types their first then last name
 * on the BBPOS pin pad. Two text inputs in a single collect_inputs call.
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

  // Three-step collect_inputs: first name (required), last name
  // (required), email (optional — skip button shown). The reader
  // walks the customer through them and returns the typed values
  // when all steps complete.
  const form = new URLSearchParams({
    "inputs[0][type]": "text",
    "inputs[0][required]": "true",
    "inputs[0][custom_text][title]": "⬢ CARBON REWARDS",
    "inputs[0][custom_text][description]": "Step 1 of 3 — your first name",
    "inputs[0][custom_text][submit_button]": "Next",
    "inputs[1][type]": "text",
    "inputs[1][required]": "true",
    "inputs[1][custom_text][title]": "⬢ CARBON REWARDS",
    "inputs[1][custom_text][description]": "Step 2 of 3 — your last name",
    "inputs[1][custom_text][submit_button]": "Next",
    "inputs[2][type]": "email",
    "inputs[2][required]": "false",
    "inputs[2][custom_text][title]": "⬢ CARBON REWARDS",
    "inputs[2][custom_text][description]":
      "Step 3 of 3 — email for e-receipts + rewards updates (optional)",
    "inputs[2][custom_text][submit_button]": "Done",
    "inputs[2][custom_text][skip_button]": "Skip",
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
