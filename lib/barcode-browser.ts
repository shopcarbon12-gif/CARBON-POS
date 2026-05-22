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
  // Heights are deliberately short so the rendered SVG's aspect ratio
  // matches the reference receipt's barcode (~28% h/w). At scale 2,
  // height 8mm gives roughly 200×56 — width:62mm in CSS produces
  // ~17mm tall, the same band as the reference.
  return bwipjs.toSVG({
    bcid: barcodeSymbology(data.trim()),
    text: data.trim(),
    scale: opts.scale ?? 2,
    height: opts.heightMm ?? 8,
    includetext: true,
    textsize: 8,
  });
}
