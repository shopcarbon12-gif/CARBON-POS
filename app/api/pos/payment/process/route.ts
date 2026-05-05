import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  reader_id: z.string().min(1),
  payment_intent_id: z.string().min(1),
});

/**
 * POST /api/pos/payment/process
 * Tells the physical Stripe Terminal reader to collect the customer's card
 * for the given PaymentIntent. The cashier sees the reader prompt the
 * customer; once they confirm, Stripe transitions the intent to
 * `requires_capture` and we move on to /capture.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const reader = await stripe().terminal.readers.processPaymentIntent(
      parsed.data.reader_id,
      { payment_intent: parsed.data.payment_intent_id },
    );
    return NextResponse.json({ reader });
  } catch (err) {
    console.error("[stripe/process]", err);
    return NextResponse.json(
      {
        error: "reader_unavailable",
        message:
          "The card reader didn't respond. Make sure it's powered on and connected.",
      },
      { status: 502 },
    );
  }
}
