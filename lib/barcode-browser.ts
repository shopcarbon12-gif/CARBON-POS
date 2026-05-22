/**
 * Client-only barcode rendering. Returns an inline SVG string that the
 * React component injects via dangerouslySetInnerHTML.
 */
import bwipjs from "bwip-js/browser";
import { barcodeSymbology, type BarcodeRenderOpts } from "@/lib/barcode";

export function renderBarcodeSvg(
  data: string,
  opts: BarcodeRenderOpts = {},
): string {
  return bwipjs.toSVG({
    bcid: barcodeSymbology(data),
    text: data,
    scale: opts.scale ?? 2,
    height: opts.heightMm ?? 12,
    includetext: true,
    textxalign: "center",
    textsize: 8,
    paddingwidth: 4,
    paddingheight: 2,
  });
}
