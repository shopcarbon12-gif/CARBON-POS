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
    bcid: barcodeSymbology(data),
    text: data,
    scale: opts.scale ?? 2,
    height: opts.heightMm ?? 12,
    includetext: true,
    textxalign: "center",
    textsize: 8,
    paddingwidth: 4,
    paddingheight: 2,
    backgroundcolor: "FFFFFF",
  });
}
