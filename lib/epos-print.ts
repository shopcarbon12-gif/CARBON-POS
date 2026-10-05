"use client";

import {
  bytesToHex,
  canvasToEscPosRaster,
  concatBytes,
  escPosCut,
  escPosFeed,
  escPosInit,
  escPosKickDrawer,
  rasterizeElement,
} from "@/lib/receipt-raster";

/**
 * POST a hex-encoded ESC/POS payload to a TM-m30II's ePOS-Print HTTPS
 * endpoint. The printer wraps raw bytes inside a `<command>` element
 * and prints them as-is, so we don't have to translate the existing
 * server-built ESC/POS into ePOS XML elements one tag at a time.
 *
 * Uses HTTPS (not HTTP) because the POS app is served from HTTPS and
 * browsers block mixed-content fetches. The TM-m30II ships with a
 * self-signed cert on port 443 — each cashier device must visit
 * `https://<printer-ip>` once and accept the certificate warning to
 * whitelist the printer; after that the fetch below works silently.
 *
 * `mode: 'no-cors'` because EPSON's web service doesn't emit CORS
 * headers. The response is opaque, so we treat any successful network
 * round-trip as "delivered" and rely on the cashier to spot a missing
 * receipt.
 */
export async function sendToEposPrinter(
  host: string,
  hexBytes: string,
): Promise<void> {
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<s:Body>` +
    `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">` +
    `<command>${hexBytes}</command>` +
    `</epos-print>` +
    `</s:Body>` +
    `</s:Envelope>`;
  const url = `https://${host}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
  await fetch(url, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: xml,
  });
}

/**
 * Rasterize an on-screen element and print it as one cut ticket.
 * `kickDrawer` pops the cash drawer after the cut.
 */
export async function printElement(
  host: string,
  el: HTMLElement,
  opts: { kickDrawer?: boolean } = {},
): Promise<void> {
  const canvas = await rasterizeElement(el);
  const job = concatBytes(
    escPosInit(),
    canvasToEscPosRaster(canvas),
    escPosFeed(3),
    escPosCut(),
    ...(opts.kickDrawer ? [escPosKickDrawer()] : []),
  );
  await sendToEposPrinter(host, bytesToHex(job));
}
