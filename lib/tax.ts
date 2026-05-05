import { round2 } from "@/lib/utils";
import type { CartLine, CartTotals } from "@/types/pos";

/**
 * Calculate cart totals.
 * - subtotal: sum of (unit_price * quantity) before discounts.
 * - discount: sum of per-line discount_amount.
 * - tax: tax_rate * (line subtotal - line discount), summed.
 * - total: subtotal - discount + tax, rounded to 2 decimals.
 *
 * All numbers are USD; tax_rate is a fraction (0.07 = 7%).
 */
export function calculateTotals(
  lines: CartLine[],
  defaultTaxRate: number,
): CartTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const line of lines) {
    const lineSubtotal = line.unit_price * line.quantity;
    const lineDiscount = line.discount_amount;
    const taxableBase = Math.max(0, lineSubtotal - lineDiscount);
    const rate = line.tax_rate || defaultTaxRate;
    const lineTax = taxableBase * rate;
    subtotal += lineSubtotal;
    discount += lineDiscount;
    tax += lineTax;
  }
  const total = subtotal - discount + tax;
  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    tax: round2(tax),
    total: round2(total),
  };
}
