/**
 * Hand-crafted EAN-13 SVG renderer that mirrors the visual style of
 * carbon_receipt_barcode_more_short_height.html exactly:
 *   - viewBox 237×68
 *   - 2.2-unit module width
 *   - 14-unit quiet zones left/right
 *   - guard bars (start / middle / end) extend down to y=47, regular
 *     digit bars stop at y=39
 *   - first digit rendered to the LEFT of the bars in Arial 14
 *   - left + right groups of 6 digits, centered under each 7-module slot
 *
 * Falls back to bwip-js Code128 only for non-EAN-13 inputs (per-location
 * sale sequence past 999 → 13+ digit sale_number).
 */
import bwipjs from "bwip-js/browser";
import {
  barcodeSymbology,
  ean13CheckDigit,
  type BarcodeRenderOpts,
} from "@/lib/barcode";

// Standard EAN-13 encoding tables. 1 = bar (black), 0 = space (white).
const L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
const R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];
// Parity of the left 6 digits is selected by the first digit.
const PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

const MODULE_W = 2.2;
const QUIET = 14;
const BARS_Y = 5;
const BAR_H_REG = 34;
const BAR_H_GUARD = 42;
const DIGIT_Y = 62;
const TOTAL_W = QUIET + 95 * MODULE_W + QUIET; // 237
const TOTAL_H = 68;

function encodeEan13(data13: string): string {
  const first = Number(data13[0]);
  const left = data13.slice(1, 7);
  const right = data13.slice(7);
  const parity = PARITY[first];
  let bits = "101"; // start guard
  for (let i = 0; i < 6; i++) {
    const d = Number(left[i]);
    bits += parity[i] === "L" ? L[d] : G[d];
  }
  bits += "01010"; // middle guard
  for (let i = 0; i < 6; i++) {
    bits += R[Number(right[i])];
  }
  bits += "101"; // end guard
  return bits;
}

/** Modules that belong to a guard band (extend below the digits). */
function isGuardModule(m: number): boolean {
  // start (0-2), middle (45-49), end (92-94)
  return m < 3 || (m >= 45 && m < 50) || m >= 92;
}

function renderEan13Svg(data12: string): string {
  const check = ean13CheckDigit(data12);
  const data13 = data12 + check;
  const bits = encodeEan13(data13);
  const FONT =
    'font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#000"';

  let bars = "";
  for (let m = 0; m < 95; m++) {
    if (bits[m] !== "1") continue;
    const x = QUIET + m * MODULE_W;
    const h = isGuardModule(m) ? BAR_H_GUARD : BAR_H_REG;
    bars += `<rect x="${x.toFixed(2)}" y="${BARS_Y}" width="${MODULE_W.toFixed(
      2,
    )}" height="${h}" fill="#000"/>`;
  }

  // First digit, right-aligned at x=9 (sits in the left quiet zone).
  let digits = `<text x="9.00" y="${DIGIT_Y}" ${FONT} text-anchor="end">${data13[0]}</text>`;
  // Left group: 6 digits centered under their 7-module slots.
  for (let i = 0; i < 6; i++) {
    const mCenter = 3 + 7 * i + 3.5;
    const x = QUIET + mCenter * MODULE_W;
    digits += `<text x="${x.toFixed(2)}" y="${DIGIT_Y}" ${FONT} text-anchor="middle">${data13[1 + i]}</text>`;
  }
  // Right group: 6 digits after the middle guard.
  for (let i = 0; i < 6; i++) {
    const mCenter = 50 + 7 * i + 3.5;
    const x = QUIET + mCenter * MODULE_W;
    digits += `<text x="${x.toFixed(2)}" y="${DIGIT_Y}" ${FONT} text-anchor="middle">${data13[7 + i]}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TOTAL_W.toFixed(2)}" ` +
    `height="${TOTAL_H}" viewBox="0 0 ${TOTAL_W.toFixed(2)} ${TOTAL_H}">` +
    `<rect width="100%" height="100%" fill="#fff"/>${bars}${digits}</svg>`
  );
}

export function renderBarcodeSvg(
  data: string,
  opts: BarcodeRenderOpts = {},
): string {
  const clean = data.trim();
  // Hand-crafted path for the common case (12-digit numeric sale numbers).
  if (barcodeSymbology(clean) === "ean13") {
    return renderEan13Svg(clean);
  }
  // Code128 fallback for sequences past 999 (13+ digit sale_number).
  return bwipjs.toSVG({
    bcid: "code128",
    text: clean,
    scale: opts.scale ?? 2,
    height: opts.heightMm ?? 6,
    includetext: true,
    textsize: 8,
  });
}
