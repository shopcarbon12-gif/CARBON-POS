"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cashier-driven RSSI proximity filter for the POS-dedicated reader.
 *
 * The reader runs at a CONSTANT 33 dBm (the CDM agent pins it) and is never
 * reconfigured — changing RF power is what wedged the chip. This slider is a
 * pure DISPLAY filter: the reader sees everything, the cart/scan UI shows only
 * tags whose RSSI is at/above the threshold (closer tag = higher RSSI). Drag
 * RIGHT to be stricter (only the item right at the register); LEFT to show
 * farther tags.
 *
 * Controlled: the parent modal owns the threshold so the read filter applies
 * LIVE (no DB round-trip). On drag we call onChange immediately, then debounce
 * a PATCH to persist it on the open register session (so it survives reloads).
 */

const RSSI_MIN = -90; // left: show everything (above the bridge's hard floor)
const RSSI_MAX = -20; // right: only the closest tags
// Operator-tuned default for the register counter (2026-05-30): shows the item
// at the register, not the shelf behind it. Closest items read ~-56..-58.
export const RSSI_DEFAULT = -56;
const DEBOUNCE_MS = 400; // just a DB write now — no reader respawn cost

export function RssiFilterSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (rssiDbm: number) => void;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate the persisted threshold from the open session on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/pos/hardware/reader/rssi-filter", {
          credentials: "same-origin",
        });
        if (!r.ok) {
          setError(`HTTP ${r.status}`);
          setHydrated(true);
          return;
        }
        const j = (await r.json()) as {
          skipped?: boolean;
          rssi_threshold_dbm?: number | null;
        };
        if (cancelled) return;
        if (j.skipped) {
          setSkipped(true);
        } else if (typeof j.rssi_threshold_dbm === "number") {
          onChange(j.rssi_threshold_dbm);
        } else {
          // No threshold yet — persist the default so the slider value is the
          // truth and the filter is deterministic across reloads.
          onChange(RSSI_DEFAULT);
          await fetch("/api/pos/hardware/reader/rssi-filter", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ rssiDbm: RSSI_DEFAULT }),
          }).catch(() => {/* best-effort */});
        }
        setHydrated(true);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (next: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetch("/api/pos/hardware/reader/rssi-filter", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ rssiDbm: next }),
      })
        .then((r) => {
          if (!r.ok) setError(`HTTP ${r.status}`);
          else setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, DEBOUNCE_MS);
  };

  if (skipped) return null; // no open register session

  return (
    <div className="flex items-center gap-3 px-1">
      <label className="text-sm text-[var(--color-pos-muted)] whitespace-nowrap">
        Proximity
      </label>
      <span className="text-xs text-[var(--color-pos-muted)]">far</span>
      <input
        type="range"
        min={RSSI_MIN}
        max={RSSI_MAX}
        step={1}
        value={value}
        disabled={!hydrated}
        onChange={(e) => {
          const next = Math.max(
            RSSI_MIN,
            Math.min(RSSI_MAX, Number(e.target.value) | 0),
          );
          onChange(next); // live — applies to the read filter immediately
          persist(next); // debounced DB write
        }}
        className="flex-1 accent-[var(--color-pos-primary)]"
        aria-label="RFID proximity filter (RSSI threshold in dBm)"
      />
      <span className="text-xs text-[var(--color-pos-muted)]">near</span>
      <span className="text-sm font-mono tabular-nums w-16 text-right">
        {value} dBm
      </span>
      {error ? (
        <span className="text-xs text-[var(--color-pos-danger)] ml-2">
          {error}
        </span>
      ) : null}
    </div>
  );
}
