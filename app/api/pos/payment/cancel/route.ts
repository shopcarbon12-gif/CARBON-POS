import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import { currentCashier } from "@/lib/session";

const schema = z
  .object({
    reader_id: z.string().min(1).optional(),
    payment_intent_id: z.string().min(1).optional(),
  })
  .refine((v) => v.reader_id || v.payment_intent_id, {
    message: "reader_id or payment_intent_id is required",
  });

/**
 * POST /api/pos/payment/cancel
 * Stops a pending pinpad collection and/or releases an uncaptured
 * PaymentIntent. Both are best-effort: a card tender removed from a
 * split sale needs the intent cancelled so we don't leave a hold on the
 * customer's card.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { reader_id, payment_intent_id } = parsed.data;
  try {
    if (reader_id) {
      try {
        await stripe().terminal.readers.cancelAction(reader_id);
      } catch (e) {
        // Reader may already be idle — don't fail the whole call.
        console.warn("[stripe/cancel] reader cancelAction:", e);
      }
    }
    if (payment_intent_id) {
      const intent = await stripe().paymentIntents.cancel(payment_intent_id);
      return NextResponse.json({ intent_status: intent.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stripe/cancel]", err);
    return NextResponse.json({ error: "stripe_failed" }, { status: 502 });
  }
}
