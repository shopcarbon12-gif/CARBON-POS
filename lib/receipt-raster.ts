"use client";

import { toCanvas } from "html-to-image";

/**
 * Browser-side helpers that turn a rendered ReceiptView DOM element into
 * an ESC/POS raster image payload the TM-m30II can print verbatim. This
 * is how we get the on-screen design onto thermal paper — printing as
 * a bitmap instead of using the printer's built-in column/font commands,
 * which can never reproduce CSS layout.
 *
 * Two-step pipeline:
 *   1. rasterizeElement — DOM → off-screen <canvas> at the printer's
 *      native horizontal resolution.
 *   2. canvasToEscPosRaster — <canvas> → 1bpp packed bitmap wrapped in
 *      the ESC/POS GS v 0 raster-image command.
 *
 * The TM-m30II's print area at 3 1/8" (≈80mm) paper is 576 dots wide.
 * We capture at ~2× the on-screen CSS width (3 1/8" = 300 px @ 96 DPI)
 * so the source is high-DPI, then resample down to 576 for a clean
 * black-and-white threshold.
 */

/** Native dot width of the TM-m30II at 3 1/8" (≈80mm) paper. */
export const PRINTER_DOT_WIDTH = 576;

/**
 * Render a DOM element to a <canvas> sized exactly to the printer's
 * dot width. Captures at 2× source resolution and resamples down with
 * the browser's built-in bilinear filtering so text is crisp.
 */
export async function rasterizeElement(
  el: HTMLElement,
  opts: { targetWidth?: number; pixelRatio?: number } = {},
): Promise<HTMLCanvasElement> {
  const targetWidth = opts.targetWidth ?? PRINTER_DOT_WIDTH;
  const pixelRatio = opts.pixelRatio ?? 2;

  // 1. High-DPI capture of the rendered element.
  const sourceCanvas = await toCanvas(el, {
    pixelRatio,
    backgroundColor: "#ffffff",
    cacheBust: true,
  });

  // 2. Resample to the printer's native width while keeping aspect ratio.
  const scale = targetWidth / sourceCanvas.width;
  const targetHeight = Math.round(sourceCanvas.height * scale);
  const out = document.createElement("canvas");
  out.width = targetWidth;
  out.height = targetHeight;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  return out;
}

/**
 * Convert an RGBA canvas to a 1-bit-per-pixel packed bitmap wrapped in
 * the ESC/POS `GS v 0` raster-image command. Output is ready to splice
 * into a print job — just prepend/append init bytes, cut, and drawer
 * commands as needed.
 *
 * Threshold is a simple 50% grayscale cutoff. Anti-aliased edges land
 * either fully black or fully white; with a 576-dot capture that still
 * looks clean to the eye.
 */
export function canvasToEscPosRaster(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const W = canvas.width;
  const H = canvas.height;
  const widthBytes = Math.ceil(W / 8);
  const img = ctx.getImageData(0, 0, W, H).data;

  const bitmap = new Uint8Array(widthBytes * H);
  for (let y = 0; y < H; y++) {
    const rowOffset = y * widthBytes;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = img[i + 3];
      if (a < 128) continue; // transparent counts as white
      const gray = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      if (gray < 128) {
        bitmap[rowOffset + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }

  // GS v 0 m xL xH yL yH d1 ... dn  — normal-mode raster bit image.
  const cmd = new Uint8Array(8 + bitmap.length);
  cmd[0] = 0x1d;
  cmd[1] = 0x76;
  cmd[2] = 0x30;
  cmd[3] = 0x00;
  cmd[4] = widthBytes & 0xff;
  cmd[5] = (widthBytes >> 8) & 0xff;
  cmd[6] = H & 0xff;
  cmd[7] = (H >> 8) & 0xff;
  cmd.set(bitmap, 8);
  return cmd;
}

/** ESC @ — reset printer (clear modes/styles from a prior job). */
export function escPosInit(): Uint8Array {
  return new Uint8Array([0x1b, 0x40]);
}

/** ESC d n — print and feed n lines. */
export function escPosFeed(lines = 3): Uint8Array {
  return new Uint8Array([0x1b, 0x64, lines]);
}

/** GS V B 0 — feed paper and partial cut. */
export function escPosCut(): Uint8Array {
  return new Uint8Array([0x1d, 0x56, 0x42, 0x00]);
}

/** ESC p 0 50 250 — kick the cash drawer (pin 2). */
export function escPosKickDrawer(): Uint8Array {
  return new Uint8Array([0x1b, 0x70, 0x00, 0x32, 0xfa]);
}

/** Concatenate Uint8Arrays in order. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Encode bytes as uppercase hex for the ePOS-Print `<command>` element. */
export function bytesToHex(arr: Uint8Array): string {
  let s = "";
  for (let i = 0; i < arr.length; i++) {
    const h = arr[i].toString(16);
    s += h.length === 1 ? "0" + h : h;
  }
  return s.toUpperCase();
}
