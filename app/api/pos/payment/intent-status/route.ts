import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe-terminal";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/payment/intent-status?id=pi_…
 *
 * Used by the PaymentModal to poll until the customer finishes interacting
 * with the reader. We could swap this for a Stripe webhook later — for now
 * polling is simpler to operate and avoids a webhook secret in dev.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  try {
    const intent = await stripe().paymentIntents.retrieve(id);
    return NextResponse.json({ id: intent.id, status: intent.status });
  } catch (err) {
    console.error("[stripe/intent-status]", err);
    return NextResponse.json({ error: "stripe_failed" }, { status: 502 });
  }
}
