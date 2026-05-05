import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  // Amount in dollars; we convert to cents.
  amount: z.number().positive(),
  description: z.string().max(500).optional(),
});

/**
 * POST /api/pos/payment/create-intent
 * Creates a manual-capture PaymentIntent for a card-present sale. The
 * cashier sends it to the reader, the customer taps/inserts/swipes, and
 * once Stripe reports the intent as `requires_capture` we capture it via
 * /api/pos/payment/capture (which also writes the sale to the DB).
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
    const intent = await stripe().paymentIntents.create({
      amount: Math.round(parsed.data.amount * 100),
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "manual",
      description: parsed.data.description,
    });
    return NextResponse.json({
      id: intent.id,
      client_secret: intent.client_secret,
      status: intent.status,
    });
  } catch (err) {
    console.error("[stripe/create-intent]", err);
    return NextResponse.json(
      {
        error: "stripe_failed",
        message: "Couldn't start the card payment. Try again.",
      },
      { status: 502 },
    );
  }
}
