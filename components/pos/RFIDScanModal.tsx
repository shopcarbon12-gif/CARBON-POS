"use client";

import { useEffect, useState } from "react";

export type RfidResolvedItem = {
  epc: string;
  sku_id: number;
  sku: string | null;
  item_name: string;
  color: string | null;
  size: string | null;
  retail_price: string | null;
};

/**
 * Connects to the WMS Hardware SDK Server-Sent Events stream of EPC reads,
 * resolves each new EPC to its SKU via /api/pos/items/by-epc, and lets the
 * cashier "Done" them all into the cart at once.
 *
 * The SSE endpoint is exposed by the WMS app at /api/hardware/epcs/stream.
 * Set NEXT_PUBLIC_WMS_RFID_STREAM_URL to override.
 */
export function RFIDScanModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (items: RfidResolvedItem[]) => void;
}) {
  const [scanned, setScanned] = useState<RfidResolvedItem[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [streamErr, setStreamErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setScanned([]);
      setSkipped(0);
      setStreamErr(null);
      return;
    }
    const url =
      process.env.NEXT_PUBLIC_WMS_RFID_STREAM_URL ||
      "/api/hardware/epcs/stream";
    const es = new EventSource(url, { withCredentials: true });
    const seen = new Set<string>();
    const buffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    async function flush() {
      flushTimer = null;
      if (buffer.length === 0) return;
      const epcs = buffer.splice(0);
      const res = await fetch("/api/pos/items/by-epc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ epcs }),
      });
      if (!res.ok) return;
      const data: { items: RfidResolvedItem[]; skipped: number } =
        await res.json();
      setScanned((prev) => {
        const have = new Set(prev.map((p) => p.epc));
        return [...prev, ...data.items.filter((i) => !have.has(i.epc))];
      });
      setSkipped((s) => s + data.skipped);
    }

    es.addEventListener("epc", (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { epc?: string };
        const epc = payload.epc;
        if (!epc || seen.has(epc)) return;
        seen.add(epc);
        buffer.push(epc);
        if (!flushTimer) flushTimer = setTimeout(flush, 200);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      setStreamErr("Lost the connection to the RFID reader.");
    };
    return () => {
      es.close();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-2xl p-6 shadow-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">RFID Scan</h2>
          <button
            onClick={onClose}
            className="text-[var(--color-pos-muted)] text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-[var(--color-pos-muted)] mb-3">
          Wave each item near the reader. The list below grows as tags are
          picked up.
        </p>
        {streamErr && (
          <p className="text-sm text-[var(--color-pos-danger)] mb-2">
            {streamErr} You can keep scanning once it reconnects.
          </p>
        )}
        <div className="flex-1 overflow-auto rounded-xl border border-[var(--color-pos-border)]">
          {scanned.length === 0 ? (
            <div className="p-6 text-center text-[var(--color-pos-muted)]">
              Waiting for tags…
            </div>
          ) : (
            <ul>
              {scanned.map((it) => (
                <li
                  key={it.epc}
                  className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-pos-border)] last:border-b-0"
                >
                  <div>
                    <p className="font-medium">{it.item_name}</p>
                    <p className="text-xs text-[var(--color-pos-muted)]">
                      {[it.color, it.size, it.sku].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-[var(--color-pos-muted)]">
                    {it.epc.slice(-6)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between mt-3">
          <p className="text-sm text-[var(--color-pos-muted)]">
            {scanned.length} ready to add
            {skipped > 0 && ` · ${skipped} skipped (already sold)`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="tap rounded-xl border border-[var(--color-pos-border)] px-4 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onAdd(scanned);
                onClose();
              }}
              disabled={scanned.length === 0}
              className="tap rounded-xl bg-[var(--color-pos-accent)] text-white px-5 font-semibold disabled:opacity-50"
            >
              Add {scanned.length} to cart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
