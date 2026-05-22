import { currentCashier } from "@/lib/session";
import { mintWmsSessionJwt } from "@/lib/wms-session";
import { posReaderForCurrentSession } from "@/lib/reader-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin SSE bridge from the POS browser to the WMS edge-scan stream.
 *
 * The POS sell screen's RFID modal opens an EventSource on this route. We
 * mint a short-lived WMS-format JWT for the signed-in cashier (HS256 over
 * the shared SESSION_SECRET — see lib/wms-session.ts), open an upstream SSE
 * connection to WMS_EDGE_STREAM_URL with `Authorization: Bearer <jwt>`, and
 * re-emit each EPC from the batched `data: {"epcs":[...]}` payload as
 * `event: epc / data: {"epc":"..."}` so the existing modal contract stays
 * unchanged.
 *
 * Zone scoping (POS-only, not the whole WMS location):
 *   The JWT carries `lid` (warehouse location). WMS scopes its stream by
 *   that — meaning a cashier subscribed naively gets scans from every
 *   reader at the location, including warehouse aisle/office/transfer
 *   readers. To stop the cross-talk we (a) pass the cashier's
 *   `is_pos_dedicated=TRUE` device UUID up as `?device_id=<uuid>` so WMS
 *   can scope the stream server-side, and (b) defensively drop any frame
 *   whose payload identifies a different device. If the register isn't
 *   paired with a POS-dedicated reader we close immediately rather than
 *   leak warehouse scans.
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
          // SSE frames are terminated by a blank line.
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

  // Defensive frame-level filter. WMS may put the reader identity on the
  // frame as `device_id` / `reader_id`, and/or flag warehouse readers
  // with `is_pos_dedicated:false`. Drop anything that clearly comes from
  // a non-POS reader. A frame with no identifying field is allowed
  // through — better than silently breaking when WMS hasn't been
  // upgraded yet — but the upstream `?device_id=` query param should
  // already keep those rare.
  const p = payload as {
    epcs?: unknown;
    device_id?: string;
    reader_id?: string;
    is_pos_dedicated?: boolean;
  };
  const frameDeviceId =
    typeof p.device_id === "string"
      ? p.device_id
      : typeof p.reader_id === "string"
        ? p.reader_id
        : null;
  if (frameDeviceId && frameDeviceId !== posReaderId) return;
  if (p.is_pos_dedicated === false) return;

  const epcs = p.epcs;
  if (!Array.isArray(epcs)) return;
  for (const e of epcs) {
    // Accept both flat strings and {epc, device_id} objects.
    if (typeof e === "string" && e) {
      send(`event: epc\ndata: ${JSON.stringify({ epc: e })}\n\n`);
      continue;
    }
    if (e && typeof e === "object") {
      const obj = e as {
        epc?: unknown;
        device_id?: unknown;
        reader_id?: unknown;
        is_pos_dedicated?: unknown;
      };
      if (typeof obj.epc !== "string" || !obj.epc) continue;
      const itemDevice =
        typeof obj.device_id === "string"
          ? obj.device_id
          : typeof obj.reader_id === "string"
            ? obj.reader_id
            : null;
      if (itemDevice && itemDevice !== posReaderId) continue;
      if (obj.is_pos_dedicated === false) continue;
      send(`event: epc\ndata: ${JSON.stringify({ epc: obj.epc })}\n\n`);
    }
  }
}
