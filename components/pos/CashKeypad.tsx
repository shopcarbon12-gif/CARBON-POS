"use client";

import { formatMoney } from "@/lib/utils";

/**
 * Cash entry pad. Used during the cash flow on /pos/payment to show the
 * cashier the running change due.
 *
 * Quick buttons append to the input rather than replacing it so a cashier
 * can build $25 by tapping $20 + $5.
 */
export function CashKeypad({
  value,
  onChange,
  total,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  total: number;
  autoFocus?: boolean;
}) {
  const cashAmount = Number(value || 0);
  const change = Math.max(0, Math.round((cashAmount - total) * 100) / 100);
  const quick = [1, 5, 10, 20, 50, 100];
  return (
    <div>
      <p className="text-[var(--color-pos-muted)] mb-3">
        Type how much cash the customer handed over. We&apos;ll show the change.
      </p>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className="tap-lg w-full rounded-2xl border border-[var(--color-pos-border)] text-3xl font-semibold px-4 mb-3"
        placeholder="0.00"
      />
      <div className="grid grid-cols-3 gap-2 mb-4">
        {quick.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              const next = Math.round((cashAmount + q) * 100) / 100;
              onChange(String(next));
            }}
            className="tap rounded-lg border border-[var(--color-pos-border)] font-semibold"
          >
            +${q}
          </button>
        ))}
      </div>
      <div className="flex justify-between items-center">
        <span className="text-[var(--color-pos-muted)]">Change</span>
        <span className="total-display text-3xl">{formatMoney(change)}</span>
      </div>
    </div>
  );
}
