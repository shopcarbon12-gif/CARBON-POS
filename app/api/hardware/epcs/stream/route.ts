import { currentCashier } from "@/lib/session";
import { mintWmsSessionJwt } from "@/lib/wms-session";

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
 * unchanged. Same-origin keeps the JWT off the browser and dodges CORS
 * (which WMS doesn't set on /api/edge/stream).
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

  const upstreamCtl = new AbortController();
  const upstream = await fetch(upstreamUrl, {
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
            handleFrame(frame, send);
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

function handleFrame(frame: string, send: (chunk: string) => void) {
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
  const epcs = (payload as { epcs?: unknown }).epcs;
  if (!Array.isArray(epcs)) return;
  for (const e of epcs) {
    if (typeof e !== "string" || !e) continue;
    send(`event: epc\ndata: ${JSON.stringify({ epc: e })}\n\n`);
  }
}
