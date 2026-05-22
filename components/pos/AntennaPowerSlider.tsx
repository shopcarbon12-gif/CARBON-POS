"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cashier-driven live RF power slider for the POS-dedicated reader.
 *
 *   - Range: 1–33 dBm (regulatory ceiling).
 *   - Hydrates initial value from /api/pos/hardware/reader/power.
 *   - Drag updates state optimistically; debounced 200 ms PATCH to the
 *     same endpoint. NO SAVE BUTTON — the slider IS the save.
 *   - Server writes pos_register_sessions.live_power_dbm. The agent's
 *     /api/cdm-agents/active-sessions poll surfaces this column to the
 *     supervisor on its next ~100 ms tick; the supervisor respawns the
 *     POS reader binary at the new power. End-to-end: drag → ~1–2 s.
 *
 *   - When the cashier's register session closes, the override clears
 *     automatically (the column lives on the session row) and the next
 *     session opens at WMS-configured (steady-state) power.
 *
 * Visual: full slider track, "WMS default" hint when at max, dBm
 * value next to the slider.
 */

const MIN_DBM = 1;
const MAX_DBM = 33;
const DEBOUNCE_MS = 200;

export function AntennaPowerSlider() {
  const [value, setValue] = useState<number>(MAX_DBM);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from server on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/pos/hardware/reader/power", {
          credentials: "same-origin",
        });
        if (!r.ok) {
          setError(`HTTP ${r.status}`);
          setHydrated(true);
          return;
        }
        const j = (await r.json()) as {
          ok?: boolean;
          skipped?: boolean;
          live_power_dbm?: number | null;
        };
        if (cancelled) return;
        if (j.skipped) {
          setSkipped(true);
        } else if (typeof j.live_power_dbm === "number") {
          setValue(j.live_power_dbm);
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
  }, []);

  const push = (next: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const r = await fetch("/api/pos/hardware/reader/power", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ powerDbm: next }),
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            setError((j as { error?: string }).error ?? `HTTP ${r.status}`);
          } else {
            setError(null);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, DEBOUNCE_MS);
  };

  if (skipped) {
    return null; // no open register session — slider not applicable
  }

  return (
    <div className="flex items-center gap-3 px-1">
      <label className="text-sm text-[var(--color-pos-muted)] whitespace-nowrap">
        RF power
      </label>
      <input
        type="range"
        min={MIN_DBM}
        max={MAX_DBM}
        step={1}
        value={value}
        disabled={!hydrated}
        onChange={(e) => {
          const next = Math.max(MIN_DBM, Math.min(MAX_DBM, Number(e.target.value) | 0));
          setValue(next);
          push(next);
        }}
        className="flex-1 accent-[var(--color-pos-primary)]"
        aria-label="Antenna RF power in dBm"
      />
      <span className="text-sm font-mono tabular-nums w-12 text-right">
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
