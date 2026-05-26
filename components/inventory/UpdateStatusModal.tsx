"use client";

import { useEffect, useRef, useState } from "react";
import { AntennaPowerSlider } from "@/components/pos/AntennaPowerSlider";

/**
 * Bulk EPC status-update modal on the Inventory tab. Mirrors the cart
 * RFIDScanModal's scan loop (SSE bridge → batched EPC lookup) but:
 *   - Looks up via /api/pos/items/lookup-for-status (returns ANY status,
 *     not just LIVE — operator might be flipping damaged → tag_killed).
 *   - Adds a target-status picker (4 options: LIVE / DAMAGED / STOLEN /
 *     TAG KILLED — narrower than WMS's full vocabulary on purpose; the
 *     riskier system statuses don't belong in a cashier-facing tool).
 *   - On Apply: confirms with a destructive-action warning for any
 *     non-LIVE target ("Only Super Admin can flip back to LIVE"), then
 *     POSTs to /api/pos/inventory/bulk-status which proxies to WMS's
 *     bulk-status endpoint — WMS owns role gates + audit writes
 *     (STATUS_CHANGE rows in inventory_audit_logs).
 *   - No "add to cart". No selection mode — Apply hits everything in
 *     the scanned list (a misclick is reversible via WMS for non-LIVE
 *     locked statuses by a Super Admin).
 */

type LookupItem = {
  epc: string;
  sku: string | null;
  upc: string | null;
  item_name: string | null;
  color: string | null;
  size: string | null;
  current_status: string;
  current_status_label: string | null;
  is_at_this_location: boolean;
};

type Target =
  | { value: "in-stock"; label: "LIVE" }
  | { value: "damaged"; label: "DAMAGED" }
  | { value: "stolen"; label: "STOLEN" }
  | { value: "tag_killed"; label: "TAG KILLED" };

const TARGETS: Target[] = [
  { value: "in-stock", label: "LIVE" },
  { value: "damaged", label: "DAMAGED" },
  { value: "stolen", label: "STOLEN" },
  { value: "tag_killed", label: "TAG KILLED" },
];

const RISKY_TARGETS = new Set<Target["value"]>(["damaged", "stolen", "tag_killed"]);

export function UpdateStatusModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [scanned, setScanned] = useState<LookupItem[]>([]);
  const [unknownCount, setUnknownCount] = useState(0);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [target, setTarget] = useState<Target["value"]>("in-stock");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; updated: number; attempted: number }
    | { kind: "err"; message: string }
    | null
  >(null);
  const [confirmingRisky, setConfirmingRisky] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());

  // SSE → batched lookup. Same shape as RFIDScanModal but using the
  // status-update lookup endpoint so any-status items can show up.
  useEffect(() => {
    if (!open) {
      setScanned([]);
      setUnknownCount(0);
      setStreamErr(null);
      setResult(null);
      setConfirmingRisky(false);
      seenRef.current.clear();
      return;
    }
    const es = new EventSource("/api/hardware/epcs/stream", { withCredentials: true });
    const buffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    async function flush() {
      flushTimer = null;
      if (buffer.length === 0) return;
      const epcs = buffer.splice(0);
      const res = await fetch("/api/pos/items/lookup-for-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ epcs }),
      });
      if (!res.ok) return;
      const data: { items: LookupItem[]; unknown_count: number } = await res.json();
      setScanned((prev) => {
        const have = new Set(prev.map((p) => p.epc));
        return [...prev, ...data.items.filter((i) => !have.has(i.epc))];
      });
      setUnknownCount((c) => c + (data.unknown_count ?? 0));
    }

    es.addEventListener("epc", (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { epc?: string };
        const epc = payload.epc?.toUpperCase();
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

  const removeItem = (epc: string) => {
    setScanned((prev) => prev.filter((it) => it.epc !== epc));
  };
  const rescan = () => {
    setScanned([]);
    setUnknownCount(0);
    setResult(null);
    seenRef.current.clear();
  };

  const onApplyClick = () => {
    if (scanned.length === 0 || applying) return;
    if (RISKY_TARGETS.has(target)) {
      setConfirmingRisky(true);
      return;
    }
    void doApply();
  };

  const doApply = async () => {
    setConfirmingRisky(false);
    setApplying(true);
    setResult(null);
    const epcs = scanned.map((s) => s.epc);
    try {
      const r = await fetch("/api/pos/inventory/bulk-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ epcs, targetStatus: target }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        updated?: number;
        error?: string;
        code?: string;
      };
      if (r.ok && j.ok) {
        setResult({ kind: "ok", updated: j.updated ?? 0, attempted: epcs.length });
        // Reflect new status in the visible rows.
        setScanned((prev) =>
          prev.map((it) => ({
            ...it,
            current_status: target,
            current_status_label: TARGETS.find((t) => t.value === target)?.label ?? null,
          })),
        );
      } else {
        const msg =
          j.code === "SUPER_ADMIN_LOCKED"
            ? "One of these tags is in a status only a Super Admin can change. Ask a manager."
            : j.code === "SYSTEM_STATUS_FORBIDDEN"
              ? "Super Admin role is required for this status."
              : j.error || `HTTP ${r.status}`;
        setResult({ kind: "err", message: msg });
      }
    } catch (e) {
      setResult({ kind: "err", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setApplying(false);
    }
  };

  if (!open) return null;

  const targetLabel = TARGETS.find((t) => t.value === target)?.label ?? target;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-2xl p-6 shadow-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-2 gap-3">
          <h2 className="text-xl font-bold shrink-0">Update Item Status</h2>
          <button
            onClick={onClose}
            className="text-[var(--color-pos-muted)] text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-[var(--color-pos-muted)] mb-3">
          Wave each item near the reader, choose the target status, then apply.
        </p>

        <div className="mb-3">
          <AntennaPowerSlider />
        </div>

        <div className="mb-3 flex items-center gap-3">
          <label className="text-sm text-[var(--color-pos-muted)] whitespace-nowrap">
            Target status
          </label>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as Target["value"]);
              setResult(null);
            }}
            className="carbon-input tap px-3 py-1.5 text-base font-semibold"
          >
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

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
                const meta = [it.sku, it.color, it.size].filter(Boolean);
                return (
                  <li
                    key={it.epc}
                    className="flex items-center justify-between gap-3 px-4 py-2 border-b border-[var(--color-pos-border)] last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-tight">
                        <span className="font-semibold text-carbon-text">
                          {it.item_name ?? it.epc}
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
                      <p className="text-xs text-carbon-text-muted mt-0.5">
                        Currently:{" "}
                        <span className="font-semibold">
                          {it.current_status_label ?? it.current_status}
                        </span>
                        {!it.is_at_this_location && (
                          <span className="ml-2 text-amber-700">· other store</span>
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

        {unknownCount > 0 && (
          <p className="mt-2 text-xs text-carbon-text-muted">
            {unknownCount} scanned tag{unknownCount === 1 ? "" : "s"} not found in the catalog (ignored).
          </p>
        )}

        {result && (
          <div
            className={`mt-3 rounded-xl border p-3 text-sm ${
              result.kind === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {result.kind === "ok"
              ? `Updated ${result.updated} of ${result.attempted} tag${result.attempted === 1 ? "" : "s"} to ${targetLabel}.`
              : result.message}
          </div>
        )}

        <div className="flex items-center justify-between mt-3">
          <p className="text-sm text-[var(--color-pos-muted)]">
            {scanned.length} ready to update
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={rescan}
              disabled={scanned.length === 0}
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
              Close
            </button>
            <button
              onClick={onApplyClick}
              disabled={scanned.length === 0 || applying}
              className="tap rounded-xl bg-[var(--color-pos-accent)] text-white px-5 font-semibold disabled:opacity-50"
            >
              {applying ? "Applying…" : `Apply Bulk Status`}
            </button>
          </div>
        </div>
      </div>

      {confirmingRisky && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
          onClick={() => setConfirmingRisky(false)}
        >
          <div
            className="bg-white max-w-md w-full p-6 rounded-2xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-red-700 mb-2">
              This change is locked once applied
            </h3>
            <p className="text-sm text-carbon-text mb-4">
              Once an item is set to <strong>{targetLabel}</strong>, only a
              Super Admin can flip it back to LIVE. You are about to do this
              to <strong>{scanned.length}</strong> tag
              {scanned.length === 1 ? "" : "s"}.
            </p>
            <p className="text-sm text-carbon-text-muted mb-4">
              Are you sure you want to proceed?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmingRisky(false)}
                className="tap rounded-xl border border-[var(--color-pos-border)] px-4 py-2 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => void doApply()}
                className="tap rounded-xl bg-red-600 text-white px-5 py-2 font-semibold"
              >
                Yes, set to {targetLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
