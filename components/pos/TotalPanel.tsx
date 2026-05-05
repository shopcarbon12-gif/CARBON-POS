"use client";

import { formatMoney } from "@/lib/utils";
import type { CartTotals } from "@/types/pos";

/**
 * Right panel of the sell screen. Subtotals + the big TOTAL number that
 * the cashier never has to hunt for, and the three primary payment
 * actions: Charge Card, Take Cash, Other.
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
    <aside className="bg-white border border-[--color-pos-border] rounded-2xl p-5 flex flex-col gap-4">
      <button
        onClick={onAddCustomer}
        className="tap rounded-xl border border-dashed border-[--color-pos-border] text-left px-4"
      >
        {customerName ? (
          <span className="font-medium">{customerName}</span>
        ) : (
          <span className="text-[--color-pos-muted]">+ Add customer</span>
        )}
      </button>

      <div className="grid grid-cols-2 gap-y-2 text-sm">
        <span className="text-[--color-pos-muted]">Subtotal</span>
        <span className="text-right">{formatMoney(totals.subtotal)}</span>
        <span className="text-[--color-pos-muted]">Discount</span>
        <span className="text-right">−{formatMoney(totals.discount)}</span>
        <span className="text-[--color-pos-muted]">Tax</span>
        <span className="text-right">{formatMoney(totals.tax)}</span>
      </div>

      <div className="border-t border-[--color-pos-border] pt-3">
        <p className="text-[--color-pos-muted] text-sm">Total</p>
        <p className="total-display text-5xl tabular-nums">
          {formatMoney(totals.total)}
        </p>
      </div>

      <button
        onClick={onApplyDiscount}
        disabled={disabled}
        className="tap rounded-xl border border-[--color-pos-border] font-medium"
      >
        Apply Discount to Sale
      </button>

      <div className="grid grid-cols-1 gap-2">
        <button
          onClick={onChargeCard}
          disabled={disabled}
          className="tap-lg rounded-2xl bg-[--color-pos-accent] text-white text-xl font-semibold disabled:opacity-50"
        >
          Charge Card
        </button>
        <button
          onClick={onTakeCash}
          disabled={disabled}
          className="tap-lg rounded-2xl bg-[--color-pos-accent-2] text-white text-xl font-semibold disabled:opacity-50"
        >
          Take Cash
        </button>
        <button
          onClick={onOtherPayment}
          disabled={disabled}
          className="tap rounded-xl border border-[--color-pos-border] font-medium"
        >
          Other (Check, Store Credit)
        </button>
      </div>
    </aside>
  );
}
