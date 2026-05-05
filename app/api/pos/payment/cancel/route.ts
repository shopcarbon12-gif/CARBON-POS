import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import { currentCashier } from "@/lib/session";

const schema = z.object({ reader_id: z.string().min(1) });

/**
 * POST /api/pos/payment/cancel
 * Cancels the in-progress action on the reader. Used when the customer
 * decides to pay differently mid-prompt.
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
  try {
    const reader = await stripe().terminal.readers.cancelAction(
      parsed.data.reader_id,
    );
    return NextResponse.json({ reader });
  } catch (err) {
    console.error("[stripe/cancel]", err);
    return NextResponse.json({ error: "stripe_failed" }, { status: 502 });
  }
}
