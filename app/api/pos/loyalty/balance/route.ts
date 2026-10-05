import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { loyaltyGet } from "@/lib/loyalty-client";

/**
 * Fallback redeem settings — only used when the loyalty service is
 * unreachable or its payload has no `rules` block. The live values are
 * owned by Carbon-Rewards (loyalty_settings). `live` defaults to true
 * because an unreachable service already returns balance: null, which
 * keeps the Redeem control hidden on its own.
 */
const FALLBACK_SETTINGS = {
  live: true,
  redeemPointsPerDollar: 10,
  redeemIncrement: 100,
  minRedeemPoints: 100,
  maxPctOfOrder: 50,
  maxDollarsPerOrder: 30,
};

type RedeemRules = {
  live?: boolean;
  redeem_points_per_dollar?: number;
  redeem_increment_points?: number;
  min_redeem_points?: number;
  max_redeem_pct_of_order?: number;
  max_redeem_dollars_per_order?: number;
};

/**
 * GET /api/pos/loyalty/balance?customer_id=42
 *
 * Thin proxy from the cashier UI to rewards.shopcarbon.com. We don't
 * expose LOYALTY_API_KEY to the browser — the cashier's auth gate is
 * the standard NextAuth session. Server-side we add the bearer.
 *
 * Returns the loyalty service's payload PLUS the redeem-tier settings
 * (mapped from the service's `rules`) so the RedeemPointsModal can
 * render without a second round-trip.
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
    rules?: RedeemRules | null;
  }>(`/api/v1/customers/${customerId}/balance`);
  if (!data) {
    // Loyalty service unreachable — return a neutral payload so the UI
    // can decide to show "—" instead of a balance.
    return NextResponse.json({
      balance: null,
      settings: FALLBACK_SETTINGS,
    });
  }
  return NextResponse.json({
    balance: data.balance ?? 0,
    dollars_value: data.dollars_value ?? 0,
    tier: data.tier ?? null,
    recent: data.recent ?? [],
    settings: settingsFromRules(data.rules),
  });
}

/** Map the service's snake_case rules onto the cashier UI's settings
 *  shape. Any missing / non-numeric field keeps its fallback value.
 *  `live` is only false when Rewards explicitly says the program is
 *  paused — the till then hides redemption (earning is unaffected). */
function settingsFromRules(rules: RedeemRules | null | undefined) {
  if (!rules) return FALLBACK_SETTINGS;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    live: rules.live !== false,
    redeemPointsPerDollar: num(rules.redeem_points_per_dollar, FALLBACK_SETTINGS.redeemPointsPerDollar),
    redeemIncrement: num(rules.redeem_increment_points, FALLBACK_SETTINGS.redeemIncrement),
    minRedeemPoints: num(rules.min_redeem_points, FALLBACK_SETTINGS.minRedeemPoints),
    maxPctOfOrder: num(rules.max_redeem_pct_of_order, FALLBACK_SETTINGS.maxPctOfOrder),
    maxDollarsPerOrder: num(rules.max_redeem_dollars_per_order, FALLBACK_SETTINGS.maxDollarsPerOrder),
  };
}
