import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { loyaltyGet } from "@/lib/loyalty-client";

/**
 * GET /api/pos/loyalty/balance?customer_id=42
 *
 * Thin proxy from the cashier UI to loyalty.shopcarbon.com. We don't
 * expose LOYALTY_API_KEY to the browser — the cashier's auth gate is
 * the standard NextAuth session. Server-side we add the bearer.
 *
 * Returns the loyalty service's payload PLUS the redeem-tier settings
 * so the RedeemPointsModal can render without a second round-trip.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const customerId = Number(url.searchParams.get("customer_id"));
  if (!Number.isFinite(customerId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const data = await loyaltyGet<{
    balance?: number;
    dollars_value?: number;
    tier?: string | null;
    recent?: unknown[];
  }>(`/api/v1/customers/${customerId}/balance`);
  if (!data) {
    // Loyalty service unreachable — return a neutral payload so the UI
    // can decide to show "—" instead of a balance.
    return NextResponse.json({
      balance: null,
      settings: {
        redeemPointsPerDollar: 10,
        redeemIncrement: 100,
        minRedeemPoints: 100,
        maxPctOfOrder: 50,
      },
    });
  }
  return NextResponse.json({
    balance: data.balance ?? 0,
    dollars_value: data.dollars_value ?? 0,
    tier: data.tier ?? null,
    recent: data.recent ?? [],
    // TODO(B6): fetch settings from loyalty service rather than hardcode.
    settings: {
      redeemPointsPerDollar: 10,
      redeemIncrement: 100,
      minRedeemPoints: 100,
      maxPctOfOrder: 50,
    },
  });
}
