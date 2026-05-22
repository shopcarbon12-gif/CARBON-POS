/**
 * Pure helpers shared by client and server.
 *
 * Sale numbers are 12-digit decimals while the per-location seq is ≤ 999
 * (e.g. "110000001007"). EAN-13 fits exactly 12 digits + 1 check, so we
 * render the numeric ticket as EAN-13 whenever the data is exactly 12
 * digits, and fall back to Code128 once the sequence grows past 999 and
 * pushes the length past 12.
 *
 * Server-only rendering lives in lib/barcode-node.ts; client-side
 * rendering lives in lib/barcode-browser.ts. Importing the right one
 * from each side keeps bwip-js's node bundle out of the client bundle.
 */

function isEan13Numeric(data: string): boolean {
  return /^\d{12}$/.test(data);
}

export function barcodeSymbology(data: string): "ean13" | "code128" {
  return isEan13Numeric(data) ? "ean13" : "code128";
}

/** EAN-13 check digit (modulo-10, weights 1/3 alternating). */
export function ean13CheckDigit(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(twelve[i]);
    sum += i % 2 === 0 ? n : n * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** Human-readable digits printed under an EAN-13 (data + check). */
export function ean13Display(data: string): string {
  return isEan13Numeric(data) ? data + ean13CheckDigit(data) : data;
}

export type BarcodeRenderOpts = {
  /** Bar height in millimetres. Default ~12mm — short enough for 80mm
   *  paper with the rest of the layout above it. */
  heightMm?: number;
  /** Module width — bwip-js param `scale`. */
  scale?: number;
};
