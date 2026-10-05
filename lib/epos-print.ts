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

export class PrintError extends Error {
  constructor(
    message: string,
    /** Printer IP for the "accept the certificate" hint (direct mode). */
    readonly host: string | null = null,
  ) {
    super(message);
  }
}

/**
 * Deliver one or more cut tickets (raw ESC/POS, hex) to the store's
 * printer. Goes through the store print agent when it's online (no
 * certificate / local-network prompts on the device); otherwise falls
 * back to the browser → printer ePOS-Print path.
 */
export async function deliverPrint(jobsHex: string[]): Promise<"agent" | "direct"> {
  const res = await fetch("/api/pos/print-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobs: jobsHex }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    mode?: "agent" | "direct";
    ids?: number[];
    host?: string | null;
    message?: string;
  };
  if (!res.ok) {
    throw new PrintError(data.message ?? "Couldn't send the print job.");
  }

  if (data.mode === "agent" && data.ids) {
    await waitForAgent(data.ids);
    return "agent";
  }

  const host = data.host;
  if (!host) {
    throw new PrintError(
      "No receipt printer is configured for this location. Set it in Settings → Locations → printer host/port.",
    );
  }
  try {
    for (const hex of jobsHex) await sendToEposPrinter(host, hex);
  } catch {
    throw new PrintError(
      `Couldn't reach the printer at ${host}. If Chrome asks to "access other ` +
        `devices on your local network", click Allow. Otherwise open ` +
        `https://${host}/ in a new tab, accept the certificate warning, ` +
        `then try again.`,
      host,
    );
  }
  return "direct";
}

/** Poll job status until the agent has printed them all (or failed). */
async function waitForAgent(ids: number[]): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    const res = await fetch(`/api/pos/print-jobs?ids=${ids.join(",")}`);
    if (!res.ok) continue;
    const { jobs } = (await res.json()) as {
      jobs: Array<{ id: number; status: string; error: string | null }>;
    };
    const failed = jobs.find((j) => j.status === "failed" || j.status === "expired");
    if (failed) {
      throw new PrintError(
        `The store print agent couldn't print: ${failed.error ?? failed.status}. Check the printer is on and has paper.`,
      );
    }
    if (jobs.length === ids.length && jobs.every((j) => j.status === "printed")) {
      return;
    }
  }
  throw new PrintError(
    "The store print agent didn't confirm the print. Check the printer, then try again.",
  );
}

/**
 * Rasterize an on-screen element and print it as one cut ticket.
 * `kickDrawer` pops the cash drawer after the cut.
 */
export async function printElement(
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
  await deliverPrint([bytesToHex(job)]);
}
