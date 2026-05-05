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

/** Format the next sale number as POS-00001, POS-00002, ... */
export function formatSaleNumber(seq: number): string {
  return `POS-${String(seq).padStart(5, "0")}`;
}
