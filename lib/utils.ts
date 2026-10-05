import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as USD. Used in totals and receipts. */
export function formatMoney(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(n) ? n : 0);
}

/** Round to two decimal places without floating-point drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Format the sale number as `[1100000][SS][SSS]` — fixed-width prefix +
 * 2-digit operator-defined store code + per-location sequence (min 3
 * digits, grows as needed past 999). The store code lives on
 * pos_locations.store_code and is independent of the DB id. The 13th
 * digit on the EAN-13 barcode is the check digit and is computed by
 * the barcode renderer, not stored.
 *
 *   formatSaleNumber("01", 7)   -> "110000001007"
 *   formatSaleNumber("02", 1000)-> "1100000021000"  (13 chars, falls back
 *                                                    to Code128 on the
 *                                                    receipt)
 */
export function formatSaleNumber(storeCode: string, saleSeq: number): string {
  const prefix = "1100000";
  const seq = String(saleSeq).padStart(3, "0");
  return `${prefix}${storeCode}${seq}`;
}

/**
 * Capitalize the first letter of each word, lowercase the rest.
 * Used for first/last name fields so display is consistent whether
 * the cashier (or pin-pad) typed "elior", "ELIOR", or "Elior".
 *
 *   "elior"       → "Elior"
 *   "ELIOR PEREZ" → "Elior Perez"
 *   "o'brien"     → "O'Brien"
 *
 * Loses internal capitals — "mcdonald" → "Mcdonald" (not "McDonald").
 * Accepted tradeoff for the 99% case of single-cap names.
 */
export function capitalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, sep, ch: string) => sep + ch.toUpperCase());
}

/**
 * Short employee label for receipts: first name + last initial, e.g.
 * "Elior Perez" → "Elior P.". Falls back to whatever's available, then to
 * the supplied fallback (typically the email) so a row never renders blank.
 */
export function formatEmployeeShort(
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string | null,
): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (f && l) return `${f} ${l[0].toUpperCase()}.`;
  if (f) return f;
  if (l) return l;
  return (fallback ?? "").trim();
}

/**
 * Amount the sales tax was charged on: price × qty − discount for every
 * line that actually carried tax. Falls back to tax ÷ rate when the line
 * detail isn't available (rounding makes that one cent-ish off, e.g.
 * $6.05 ÷ 6.5% = $93.08 for a $93.00 item).
 */
export function taxableBase(
  lines: Array<{
    quantity: number | string;
    unit_price?: number | string | null;
    discount_amount?: number | string | null;
    tax_amount?: number | string | null;
  }>,
  taxAmount: number,
  taxRate: number | null,
): number | null {
  if (lines.length && lines.every((l) => l.unit_price != null && l.tax_amount != null)) {
    const base = lines
      .filter((l) => Number(l.tax_amount) > 0)
      .reduce(
        (a, l) => a + Number(l.unit_price) * Number(l.quantity) - Number(l.discount_amount ?? 0),
        0,
      );
    return round2(base);
  }
  return taxRate && taxRate > 0 ? round2(taxAmount / taxRate) : null;
}
