import { currentCashier } from "@/lib/session";
import { mintWmsSessionJwt } from "@/lib/wms-session";
import { posReaderForCurrentSession } from "@/lib/reader-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hard RSSI floor (dBm, negative). The POS reader runs at a constant 33 dBm and
 * can see far stock; we drop anything below this floor at the bridge so the
 * browser isn't fire-hosed. The cashier's slider does the real proximity cut
 * ABOVE this floor (its range starts here). Tune as needed.
 */
const POS_RSSI_FLOOR_DBM = -70;

/**
 * Same-origin SSE bridge from the POS browser to the WMS edge-scan stream.
 *
 * The POS sell screen's RFID modal opens an EventSource on this route. We
 * mint a short-lived WMS-format JWT for the signed-in cashier (HS256 over
 * the shared SESSION_SECRET — see lib/wms-session.ts), open an upstream SSE
 * connection to WMS_EDGE_STREAM_URL with `Authorization: Bearer <jwt>`, and
 * re-emit each EPC from the batched payload as
 * `event: epc / data: {"epc":"..."}` so the existing modal contract stays
 * unchanged.
 *
 * Zone scoping (POS-only, not the whole WMS location):
 *   WMS scopes /api/edge/stream by tenant + location only — every reader
 *   at the location fans out to every subscriber. The publisher attaches
 *   `deviceId` (camelCase) to each frame (see WMS
 *   lib/server/edge-scan-hub.ts EdgeScanStreamPayload). We resolve the
 *   cashier's POS-dedicated reader UUID via posReaderForCurrentSession
 *   and STRICTLY drop any frame whose `deviceId` doesn't match. If the
 *   register isn't paired with an is_pos_dedicated=TRUE device, the
 *   stream refuses to open at all — better an explicit error than
 *   warehouse cross-talk into the cart.
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const upstreamUrl = process.env.WMS_EDGE_STREAM_URL?.trim();
  if (!upstreamUrl) {
    return new Response(
      JSON.stringify({
        error: "rfid_stream_not_configured",
        hint: "Set WMS_EDGE_STREAM_URL on the POS server.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  // Resolve the POS-dedicated reader (`is_pos_dedicated=TRUE`) attached to
  // the cashier's currently-open register session. We refuse to bridge any
  // EPCs if this is missing — better an empty stream than warehouse
  // cross-talk into the cart.
  const posReader = await posReaderForCurrentSession(cashier.user_id).catch(
    () => null,
  );
  if (!posReader) {
    return new Response(
      JSON.stringify({
        error: "no_pos_reader_paired",
        message:
          "This register isn't paired with a POS-dedicated RFID reader. Ask an admin to set is_pos_dedicated=TRUE on the right device in WMS.",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }
  const posReaderId = posReader.reader_id;

  let upstreamToken: string;
  try {
    upstreamToken = await mintWmsSessionJwt(cashier);
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "rfid_stream_not_configured",
        hint: e instanceof Error ? e.message : "JWT mint failed",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  // Append `device_id` so WMS can pre-filter server-side. Harmless when
  // WMS ignores the param — the in-proxy filter in handleFrame catches
  // anything that still slips through.
  const scopedUrl = (() => {
    try {
      const u = new URL(upstreamUrl);
      u.searchParams.set("device_id", posReaderId);
      u.searchParams.set("pos_only", "1");
      return u.toString();
    } catch {
      return upstreamUrl;
    }
  })();

  const upstreamCtl = new AbortController();
  const upstream = await fetch(scopedUrl, {
    headers: {
      accept: "text/event-stream",
      // SSE MUST NOT be gzipped — gzip buffers waiting for compressible
      // data and breaks the flush-per-line streaming contract. WMS still
      // sets content-encoding: gzip on these responses (server-side bug
      // worth fixing eventually); meanwhile we explicitly ask for raw
      // bytes. Confirmed 2026-05-26 the POS container's Node 20 fetch
      // does NOT auto-decompress this stream — without identity, only
      // the first 27 bytes ever arrive and the modal stays empty.
      "accept-encoding": "identity",
      authorization: `Bearer ${upstreamToken}`,
    },
    signal: upstreamCtl.signal,
    cache: "no-store",
  }).catch((e: unknown) => {
    return new Response(null, {
      status: 502,
      statusText: e instanceof Error ? e.message : "upstream_unreachable",
    });
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({
        error: "upstream_error",
        status: upstream.status,
        statusText: upstream.statusText,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* client disconnected */
        }
      };

      send("retry: 15000\n\n");
      send(": connected\n\n");

      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(ping);
        }
      }, 25_000);

      const reader = upstream.body!.getReader();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleFrame(frame, posReaderId, send);
          }
        }
      } catch {
        /* upstream closed or aborted */
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      upstreamCtl.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function handleFrame(
  frame: string,
  posReaderId: string,
  send: (chunk: string) => void,
) {
  const lines = frame.split("\n");
  let dataLine = "";
  let isComment = false;
  for (const line of lines) {
    if (line.startsWith(":")) {
      isComment = true;
      continue;
    }
    if (line.startsWith("data:")) {
      dataLine += line.slice(5).trimStart();
    }
  }
  if (isComment && !dataLine) return;
  if (!dataLine) return;
  let payload: unknown;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") return;

  // WMS publishes EdgeScanStreamPayload as
  //   { deviceId: string, locationId: string, scanContext: string,
  //     epcs: string[], ... }
  // (carbon-warehouse-management/lib/server/edge-scan-hub.ts). We
  // STRICTLY drop any frame whose deviceId isn't the POS-dedicated
  // reader. Frames with no deviceId are also dropped — better to deliver
  // nothing than to leak warehouse aisle / office / transfer scans into
  // the cashier's cart.
  const p = payload as {
    deviceId?: unknown;
    epcs?: unknown;
    epcRssiMap?: unknown;
  };
  if (typeof p.deviceId !== "string" || p.deviceId !== posReaderId) return;

  const epcs = p.epcs;
  if (!Array.isArray(epcs)) return;
  // Per-EPC RSSI (dBm, negative; closer tag = higher). Lets the cart UI filter
  // by proximity now that the POS reader is pinned at 33 dBm. Drop far-field
  // noise below POS_RSSI_FLOOR_DBM here; the slider does the fine cut above it.
  const rssiMap =
    p.epcRssiMap && typeof p.epcRssiMap === "object"
      ? (p.epcRssiMap as Record<string, number>)
      : {};
  for (const e of epcs) {
    if (typeof e !== "string" || !e) continue;
    const raw = rssiMap[e.toUpperCase()];
    const rssi = typeof raw === "number" ? raw : null;
    if (rssi !== null && rssi < POS_RSSI_FLOOR_DBM) continue;
    send(`event: epc\ndata: ${JSON.stringify({ epc: e, rssi })}\n\n`);
  }
}
