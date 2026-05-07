"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";

/**
 * Modal for redeeming loyalty points at the register. Validates against
 * the customer's balance, the program's redeem increment, and a
 * client-side cap (50% of subtotal) — the loyalty server enforces the
 * authoritative cap.
 *
 * On confirm, the parent adds a cart line with line_type='loyalty_redemption',
 * unit_price 0, discount_amount equal to the redemption value, and
 * description "Loyalty redemption · X pts" so the capture-route can parse
 * the points count when it queues the loyalty redeem call.
 */
export function RedeemPointsModal({
  open,
  customer,
  balance,
  subtotal,
  redeemPointsPerDollar,
  redeemIncrement,
  minRedeemPoints,
  maxPctOfOrder,
  onConfirm,
  onClose,
}: {
  open: boolean;
  customer: { name: string };
  balance: number;
  subtotal: number;
  redeemPointsPerDollar: number;   // 10 = 100 pts → $10
  redeemIncrement: number;          // 100 pts
  minRedeemPoints: number;          // 100
  maxPctOfOrder: number;            // 50 = 50%
  onConfirm: (points: number, dollarsOff: number) => void;
  onClose: () => void;
}) {
  const [pickedPoints, setPickedPoints] = useState<number>(0);

  const tiers = useMemo(() => {
    const tiers: { points: number; dollars: number }[] = [];
    const maxByBalance = Math.floor(balance / redeemIncrement) * redeemIncrement;
    const maxBySubtotal = Math.floor(
      (subtotal * maxPctOfOrder / 100) * redeemPointsPerDollar / redeemIncrement,
    ) * redeemIncrement;
    const cap = Math.min(maxByBalance, maxBySubtotal);
    for (let p = redeemIncrement; p <= cap; p += redeemIncrement) {
      tiers.push({ points: p, dollars: p / redeemPointsPerDollar });
    }
    return tiers;
  }, [balance, subtotal, redeemPointsPerDollar, redeemIncrement, maxPctOfOrder]);

  useEffect(() => {
    if (open && pickedPoints === 0 && tiers[0]) setPickedPoints(tiers[0].points);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tiers]);

  if (!open) return null;
  const dollars = pickedPoints / redeemPointsPerDollar;
  const eligible = balance >= minRedeemPoints && tiers.length > 0;

  return (
    <div className="fixed inset-0 bg-black/55 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-md p-6 shadow-lg border border-carbon-border">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-xl font-bold text-carbon-text">Redeem points</h2>
            <p className="text-sm text-carbon-text-muted mt-0.5">
              {customer.name} · <b>{balance.toLocaleString()} pts</b> available
            </p>
          </div>
          <button onClick={onClose} className="text-carbon-text-muted hover:text-carbon-text text-2xl leading-none px-2">×</button>
        </div>

        {!eligible ? (
          <p className="text-sm text-carbon-text-muted py-6 text-center">
            {balance < minRedeemPoints
              ? `Minimum redemption is ${minRedeemPoints} points.`
              : "This order subtotal is too low to apply any redemption tier."}
          </p>
        ) : (
          <div className="space-y-2 mt-2">
            {tiers.map((t) => (
              <button
                key={t.points}
                type="button"
                onClick={() => setPickedPoints(t.points)}
                className={`w-full text-left p-3 border flex items-center gap-3 ${
                  pickedPoints === t.points
                    ? "border-carbon-blue bg-[var(--carbon-blue-soft)]"
                    : "border-carbon-border-soft hover:bg-[var(--carbon-surface-soft)]"
                }`}
              >
                <span className="w-12 text-right font-bold tabular-nums">{t.points}</span>
                <span className="flex-1 text-sm">pts → {formatMoney(t.dollars)} off</span>
                <span className="text-xs text-carbon-text-muted tabular-nums">
                  Leaves {(balance - t.points).toLocaleString()} pts
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="carbon-btn-secondary tap px-5 font-semibold">Cancel</button>
          <button
            type="button"
            disabled={!eligible || pickedPoints === 0}
            onClick={() => onConfirm(pickedPoints, dollars)}
            className="carbon-btn-primary tap px-5 font-semibold disabled:opacity-50"
          >
            Apply {formatMoney(dollars)} off
          </button>
        </div>
      </div>
    </div>
  );
}
