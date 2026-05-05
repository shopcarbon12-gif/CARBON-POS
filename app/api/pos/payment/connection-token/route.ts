import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe-terminal";
import { currentCashier } from "@/lib/session";

/**
 * POST /api/pos/payment/connection-token
 * Returns a short-lived secret the browser uses to initialize the
 * stripe-terminal-js SDK and connect to a paired reader.
 */
export async function POST() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const token = await stripe().terminal.connectionTokens.create();
    return NextResponse.json({ secret: token.secret });
  } catch (err) {
    console.error("[stripe/connection-token]", err);
    return NextResponse.json(
      { error: "stripe_unavailable", message: "Card system is offline." },
      { status: 502 },
    );
  }
}
