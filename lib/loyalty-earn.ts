/**
 * Local mirror of the rewards-service earn formula. Used to render
 * "points earned this sale" on the receipt for members and the
 * "you-would-have-earned" prompt on walk-in receipts.
 *
 * Source of truth is rewards.shopcarbon.com — we don't write to its
 * ledger here. If the env vars below ever drift from the service config
 * the receipt number will mislead the customer by a small amount, but
 * the actual points credited come from the service-side earn endpoint
 * (queued via pos_loyalty_outbox in the capture route).
 */

/** Points awarded per $1 of eligible spend. Default 1pt/$1. */
const POINTS_PER_DOLLAR = numberEnv("LOYALTY_POINTS_PER_DOLLAR", 1);
/** Points-to-dollars cashback rate (10 pts ≈ $1). Default 10. */
const POINTS_PER_REDEEM_DOLLAR = numberEnv("LOYALTY_POINTS_PER_REDEEM_DOLLAR", 10);

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type Earn = {
  /** Whole points the customer earned (or would have earned) on this sale. */
  points: number;
  /** Equivalent dollar value of those points at the current redeem rate. */
  dollar_value: number;
};

/**
 * Compute the eligible-amount earn for a sale. `giftCardLineValue` is
 * subtracted out so customers don't earn points on loading a gift card
 * (matches the capture route's eligibleAmount calculation).
 */
export function computeEarn(args: {
  subtotal: number | string;
  discount: number | string;
  gift_card_value?: number | string;
}): Earn {
  const subtotal = Number(args.subtotal) || 0;
  const discount = Number(args.discount) || 0;
  const gift = Number(args.gift_card_value ?? 0) || 0;
  const eligible = Math.max(0, subtotal - discount - gift);
  const points = Math.floor(eligible * POINTS_PER_DOLLAR);
  const dollar_value = Math.round((points / POINTS_PER_REDEEM_DOLLAR) * 100) / 100;
  return { points, dollar_value };
}
