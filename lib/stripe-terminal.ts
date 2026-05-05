import Stripe from "stripe";

let client: Stripe | null = null;

/**
 * Singleton Stripe Node SDK client. The browser uses stripe-terminal-js and
 * fetches a connection token from /api/pos/payment/connection-token. All
 * actual money movement (intents, captures, refunds) happens server-side.
 */
export function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  client = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
  return client;
}
