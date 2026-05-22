/**
 * Server-only barcode rendering. Imports bwip-js's node bundle via the
 * package's "./node" conditional export so TS sees a buffer-returning
 * toBuffer().
 */
import bwipjs from "bwip-js/node";
import { barcodeSymbology, type BarcodeRenderOpts } from "@/lib/barcode";

export async function renderBarcodePng(
  data: string,
  opts: BarcodeRenderOpts = {},
): Promise<Buffer> {
  return await bwipjs.toBuffer({
    bcid: barcodeSymbology(data.trim()),
    text: data.trim(),
    scale: opts.scale ?? 2,
    height: opts.heightMm ?? 8,
    includetext: true,
    textsize: 8,
    backgroundcolor: "FFFFFF",
  });
}
