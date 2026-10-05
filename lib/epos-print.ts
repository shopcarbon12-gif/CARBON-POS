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

export class PrintError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Deliver one or more cut tickets (raw ESC/POS, hex) to the store's
 * printer through the store print agent (server queue → agent → printer).
 */
export async function deliverPrint(jobsHex: string[]): Promise<void> {
  const res = await fetch("/api/pos/print-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobs: jobsHex }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ids?: number[];
    agent_online?: boolean;
    message?: string;
  };
  if (!res.ok || !data.ids) {
    throw new PrintError(data.message ?? "Couldn't send the print job.");
  }
  await waitForAgent(data.ids, data.agent_online !== false);
}

/** Poll job status until the agent has printed them all (or failed). */
async function waitForAgent(ids: number[], online: boolean): Promise<void> {
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
    online
      ? "The printer didn't confirm the print. Check it's on and has paper, then try again."
      : "The store printer connection is offline. The print will come out automatically if it reconnects in the next 2 minutes.",
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
