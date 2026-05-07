"use client";

import { formatMoney } from "@/lib/utils";

type SaleHeader = {
  sale_number: string;
  location_name: string;
  register_name: string;
  cashier_email: string;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  completed_at: string | null;
  created_at: string;
  return_policy: string | null;
  receipt_footer?: string | null;
};

type LineRow = {
  id: number;
  description: string;
  quantity: number;
  line_total: string;
};

type PaymentRow = {
  id: number;
  method: "card" | "cash" | "check" | "store_credit" | string;
  amount: string;
  change_given?: string | null;
};

/**
 * Receipt body. Used on the /pos/receipt screen and on /admin/sales/[id] for
 * a print-preview style view.
 */
export function ReceiptView({
  sale,
  lines,
  payments,
}: {
  sale: SaleHeader;
  lines: LineRow[];
  payments: PaymentRow[];
}) {
  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-6">
      <div className="text-center mb-4">
        <h1 className="text-2xl font-bold">{sale.location_name}</h1>
        <p className="text-[var(--color-pos-muted)] text-sm">
          Sale {sale.sale_number} · {sale.register_name}
        </p>
        <p className="text-[var(--color-pos-muted)] text-sm">
          {new Date(sale.completed_at ?? sale.created_at).toLocaleString()}
        </p>
      </div>
      <ul className="border-t border-[var(--color-pos-border)] pt-3">
        {lines.map((l) => (
          <li key={l.id} className="flex justify-between py-1 text-sm">
            <span>
              {l.quantity}× {l.description}
            </span>
            <span className="tabular-nums">{formatMoney(l.line_total)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-[var(--color-pos-border)] pt-3 grid grid-cols-2 gap-y-1 text-sm">
        <span>Subtotal</span>
        <span className="text-right">{formatMoney(sale.subtotal)}</span>
        <span>Discount</span>
        <span className="text-right">−{formatMoney(sale.discount_amount)}</span>
        <span>Tax</span>
        <span className="text-right">{formatMoney(sale.tax_amount)}</span>
        <span className="font-bold text-lg">Total</span>
        <span className="text-right font-bold text-lg">
          {formatMoney(sale.total_amount)}
        </span>
      </div>
      <div className="mt-3 border-t border-[var(--color-pos-border)] pt-3 grid grid-cols-2 gap-y-1 text-sm">
        {payments.map((p) => (
          <span key={p.id} className="contents">
            <span>{humanMethod(p.method)}</span>
            <span className="text-right">{formatMoney(p.amount)}</span>
            {p.method === "cash" && p.change_given ? (
              <>
                <span className="text-[var(--color-pos-muted)]">Change</span>
                <span className="text-right text-[var(--color-pos-muted)]">
                  {formatMoney(p.change_given)}
                </span>
              </>
            ) : null}
          </span>
        ))}
      </div>
      {sale.return_policy && (
        <p className="mt-4 text-center text-xs text-[var(--color-pos-muted)]">
          {sale.return_policy}
        </p>
      )}
      {sale.receipt_footer && (
        <p className="mt-1 text-center text-xs text-[var(--color-pos-muted)]">
          {sale.receipt_footer}
        </p>
      )}
    </div>
  );
}

export function humanMethod(m: string): string {
  return (
    {
      card: "Card",
      cash: "Cash",
      check: "Check",
      store_credit: "Store credit",
      account: "Account",
      gift_card: "Gift card",
    }[m] ?? m
  );
}
