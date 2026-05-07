"use client";

import { formatMoney } from "@/lib/utils";
import type { CartTotals } from "@/types/pos";

/**
 * Right-side checkout panel per the carbon_sales_interface_active_cart_light
 * reference. Top: customer + Change pill. Middle: Subtotal / Discount / Tax
 * with a big Total row. Bottom: Apply discount + Charge Card + Take Cash +
 * Other.
 */
export function TotalPanel({
  totals,
  customerName,
  onAddCustomer,
  onApplyDiscount,
  onChargeCard,
  onTakeCash,
  onOtherPayment,
  disabled,
}: {
  totals: CartTotals;
  customerName: string | null;
  onAddCustomer: () => void;
  onApplyDiscount: () => void;
  onChargeCard: () => void;
  onTakeCash: () => void;
  onOtherPayment: () => void;
  disabled: boolean;
}) {
  return (
    <aside className="carbon-card flex flex-col">
      {/* Customer */}
      <div className="p-6 border-b border-[var(--carbon-border-soft)] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-[var(--carbon-muted)] mb-1 uppercase tracking-wider font-bold">
            Customer
          </div>
          <div className="font-semibold text-lg truncate">
            {customerName ?? "Walk-in"}
          </div>
        </div>
        <button
          type="button"
          onClick={onAddCustomer}
          className="carbon-btn-secondary text-sm font-medium px-4 py-1.5 shrink-0"
        >
          Change
        </button>
      </div>

      {/* Totals */}
      <div className="p-6 space-y-3 flex-1">
        <div className="flex justify-between text-[var(--carbon-muted)]">
          <span>Subtotal</span>
          <span className="font-medium text-carbon-text tabular-nums">
            {formatMoney(totals.subtotal)}
          </span>
        </div>
        {totals.discount > 0 ? (
          <div className="flex justify-between text-emerald-700">
            <span>Discount</span>
            <span className="font-medium tabular-nums">
              −{formatMoney(totals.discount)}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between text-[var(--carbon-muted)] pb-4 border-b border-[var(--carbon-border-soft)]">
          <span>Tax</span>
          <span className="font-medium text-carbon-text tabular-nums">
            {formatMoney(totals.tax)}
          </span>
        </div>
        <div className="flex justify-between items-end pt-2">
          <span className="text-xl font-bold">Total</span>
          <span className="total-display text-4xl">
            {formatMoney(totals.total)}
          </span>
        </div>
      </div>

      {/* Payment buttons */}
      <div className="p-6 space-y-4 bg-[var(--carbon-surface-soft)] border-t border-[var(--carbon-border-soft)]">
        <button
          type="button"
          onClick={onApplyDiscount}
          disabled={disabled}
          className="w-full carbon-btn-secondary tap font-semibold disabled:opacity-50"
        >
          Apply Discount to Sale
        </button>
        <button
          type="button"
          onClick={onChargeCard}
          disabled={disabled}
          className="w-full carbon-btn-primary tap-lg text-lg font-bold disabled:opacity-50"
        >
          Charge Card
        </button>
        <button
          type="button"
          onClick={onTakeCash}
          disabled={disabled}
          className="w-full carbon-btn-primary tap-lg text-lg font-bold disabled:opacity-50"
        >
          Take Cash
        </button>
        <button
          type="button"
          onClick={onOtherPayment}
          disabled={disabled}
          className="w-full carbon-btn-secondary tap font-semibold disabled:opacity-50"
        >
          Other (Check, Store Credit)
        </button>
      </div>
    </aside>
  );
}
