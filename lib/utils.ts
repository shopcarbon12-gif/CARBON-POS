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
 * Format the sale number as `[1100000][LL][SSS]` — fixed-width prefix +
 * 2-digit location code + per-location sequence (min 3 digits, grows as
 * needed past 999). The 13th digit on the EAN-13 barcode is the check
 * digit and is computed by the barcode renderer, not stored.
 *
 *   formatSaleNumber(1, 7)   -> "110000001007"
 *   formatSaleNumber(2, 1000)-> "1100000021000"  (13 chars, falls back
 *                                                 to Code128 on the
 *                                                 receipt)
 */
export function formatSaleNumber(locationId: number, saleSeq: number): string {
  const prefix = "1100000";
  const loc = String(locationId).padStart(2, "0");
  const seq = String(saleSeq).padStart(3, "0");
  return `${prefix}${loc}${seq}`;
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
