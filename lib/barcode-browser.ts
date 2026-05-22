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
  // Heights kept very short so the SVG's aspect ratio matches the
  // reference receipt's barcode band. At scale 2, height 6mm gives a
  // viewBox close to 210×54 — width:62mm in CSS produces ~16mm tall,
  // matching the printed reference.
  return bwipjs.toSVG({
    bcid: barcodeSymbology(data.trim()),
    text: data.trim(),
    scale: opts.scale ?? 2,
    height: opts.heightMm ?? 6,
    includetext: true,
    textsize: 8,
  });
}
