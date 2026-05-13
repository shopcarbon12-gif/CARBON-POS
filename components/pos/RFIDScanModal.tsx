"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";

export type RfidResolvedItem = {
  epc: string;
  sku_id: string;
  sku: string | null;
  upc: string | null;
  item_name: string;
  color: string | null;
  size: string | null;
  retail_price: string | null;
};

/**
 * Connects to the POS-side SSE bridge at /api/hardware/epcs/stream (which
 * server-side proxies the WMS edge-scan stream — see the route file for the
 * upstream auth + payload reshape), resolves each new EPC to its SKU via
 * /api/pos/items/by-epc, and lets the cashier "Done" them all into the cart
 * at once. Same-origin keeps the cashier's session cookie attached and the
 * upstream Bearer token off the wire to the browser.
 */
export type ReaderUiState =
  | "off"
  | "on"
  | "starting"
  | "stopping"
  | "no_reader"
  | "unreachable";

export function RFIDScanModal({
  open,
  onClose,
  onAdd,
  readerState,
  onToggleReader,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (items: RfidResolvedItem[]) => void;
  readerState: ReaderUiState;
  onToggleReader: () => void;
}) {
  const [scanned, setScanned] = useState<RfidResolvedItem[]>([]);
  const [unknownCount, setUnknownCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [promoted, setPromoted] = useState(0);
  const [blocked, setBlocked] = useState<Array<{ epc: string; status: string }>>(
    [],
  );
  const [streamErr, setStreamErr] = useState<string | null>(null);
  // De-dupe set held in a ref so the trash + Rescan handlers can mutate
  // it (an item removed from the cart should be re-scannable; Rescan
  // clears everything).
  const seenRef = useRef<Set<string>>(new Set());

  const removeItem = (epc: string) => {
    setScanned((prev) => prev.filter((it) => it.epc !== epc));
    seenRef.current.delete(epc);
  };
  const rescan = () => {
    setScanned([]);
    setUnknownCount(0);
    setFilteredCount(0);
    setPromoted(0);
    setBlocked([]);
    seenRef.current.clear();
  };

  useEffect(() => {
    if (!open) {
      setScanned([]);
      setUnknownCount(0);
      setFilteredCount(0);
      setPromoted(0);
      setBlocked([]);
      setStreamErr(null);
      seenRef.current.clear();
      return;
    }
    const es = new EventSource("/api/hardware/epcs/stream", {
      withCredentials: true,
    });
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
      const data: {
        items: RfidResolvedItem[];
        skipped: number;
        promote_count?: number;
        blocked?: Array<{ epc: string; status: string }>;
        dropped_count?: number;
        unknown_count?: number;
      } = await res.json();
      setScanned((prev) => {
        const have = new Set(prev.map((p) => p.epc));
        return [...prev, ...data.items.filter((i) => !have.has(i.epc))];
      });
      setUnknownCount((c) => c + (data.unknown_count ?? 0));
      setFilteredCount((c) => c + (data.dropped_count ?? 0));
      setPromoted((p) => p + (data.promote_count ?? 0));
      if (data.blocked?.length) {
        setBlocked((prev) => {
          const have = new Set(prev.map((b) => b.epc));
          return [...prev, ...data.blocked!.filter((b) => !have.has(b.epc))];
        });
      }
    }

    es.addEventListener("epc", (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { epc?: string };
        const epc = payload.epc;
        if (!epc || seenRef.current.has(epc)) return;
        seenRef.current.add(epc);
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
        <div className="flex items-center justify-between mb-2 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-xl font-bold shrink-0">RFID Scan</h2>
            <ReaderStatusBadge state={readerState} onToggle={onToggleReader} />
          </div>
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
              {scanned.map((it) => {
                const price = it.retail_price ? formatMoney(Number(it.retail_price)) : null;
                const meta = [it.sku, it.color, it.size, price].filter(Boolean);
                return (
                  <li
                    key={it.epc}
                    className="flex items-center justify-between gap-3 px-4 py-2 border-b border-[var(--color-pos-border)] last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-tight">
                        <span className="font-semibold text-carbon-text">
                          {it.item_name}
                        </span>
                        {meta.length > 0 && (
                          <span className="text-carbon-text-muted">
                            {meta.map((m, idx) => (
                              <span key={idx}>
                                <span className="mx-1.5 opacity-50">·</span>
                                {m}
                              </span>
                            ))}
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(it.epc)}
                      aria-label="Remove from list"
                      title="Remove from list"
                      className="shrink-0 w-9 h-9 flex items-center justify-center text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <span className="material-symbols-outlined text-[20px]" aria-hidden>
                        delete
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {blocked.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
            <p className="font-semibold text-red-800 mb-1">
              Needs supervisor — {blocked.length} tag{blocked.length === 1 ? "" : "s"} blocked
            </p>
            <ul className="text-xs text-red-700 space-y-0.5 max-h-24 overflow-auto">
              {blocked.slice(0, 8).map((b) => (
                <li key={b.epc}>{b.status}</li>
              ))}
              {blocked.length > 8 && (
                <li className="italic">+ {blocked.length - 8} more</li>
              )}
            </ul>
          </div>
        )}
        <div className="flex items-center justify-between mt-3">
          <p className="text-sm text-[var(--color-pos-muted)]">
            {scanned.length} ready to add
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={rescan}
              disabled={scanned.length === 0 && blocked.length === 0}
              className="tap rounded-xl border border-[var(--color-pos-border)] px-4 font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
              title="Clear list and start scanning again"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden>
                refresh
              </span>
              Rescan
            </button>
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

/**
 * Small pill in the RFID Scan modal header showing the reader's power
 * state. Click to manually toggle. State is driven by the SellScreen's
 * lifecycle hooks + 20s WMS reconcile poll + idle watchdog — this view
 * just renders it.
 */
function ReaderStatusBadge({
  state,
  onToggle,
}: {
  state: ReaderUiState;
  onToggle: () => void;
}) {
  const info: Record<
    ReaderUiState,
    { label: string; dot: string; tint: string; clickable: boolean }
  > = {
    on: {
      label: "Reader on",
      dot: "bg-emerald-500",
      tint: "border-emerald-200 bg-emerald-50 text-emerald-800",
      clickable: true,
    },
    off: {
      label: "Reader off — click to start",
      dot: "bg-carbon-text-muted",
      tint: "border-carbon-border-soft bg-white text-carbon-text-muted",
      clickable: true,
    },
    starting: {
      label: "Starting reader…",
      dot: "bg-amber-400 animate-pulse",
      tint: "border-amber-200 bg-amber-50 text-amber-800",
      clickable: false,
    },
    stopping: {
      label: "Stopping reader…",
      dot: "bg-amber-400 animate-pulse",
      tint: "border-amber-200 bg-amber-50 text-amber-800",
      clickable: false,
    },
    no_reader: {
      label: "No reader paired",
      dot: "bg-carbon-border",
      tint: "border-carbon-border-soft bg-white text-carbon-text-muted",
      clickable: false,
    },
    unreachable: {
      label: "Reader unreachable",
      dot: "bg-red-500",
      tint: "border-red-200 bg-red-50 text-red-800",
      clickable: false,
    },
  };
  const s = info[state];
  return (
    <button
      type="button"
      onClick={s.clickable ? onToggle : undefined}
      disabled={!s.clickable}
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold ${s.tint} ${s.clickable ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
    >
      <span className={`w-2 h-2 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </button>
  );
}
