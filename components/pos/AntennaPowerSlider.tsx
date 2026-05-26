"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cashier-driven live RF power slider for the POS-dedicated reader.
 *
 *   - Range: 1–33 dBm (regulatory ceiling).
 *   - Hydrates initial value from /api/pos/hardware/reader/power.
 *   - Drag updates state optimistically; debounced 1.5 s PATCH to the
 *     same endpoint. NO SAVE BUTTON — the slider IS the save. The long
 *     debounce is deliberate: each PATCH costs a SIGTERM + respawn of
 *     the reader binary (see DEBOUNCE_MS constant for the rationale).
 *   - Server writes pos_register_sessions.live_power_dbm. The agent's
 *     /api/cdm-agents/active-sessions poll surfaces this column to the
 *     supervisor on its next ~100 ms tick; the supervisor respawns the
 *     POS reader binary at the new power. End-to-end after release:
 *     ~5 s on the happy path; can stretch to 25 s+ on a wedged chip.
 *
 *   - When the cashier's register session closes, the override clears
 *     automatically (the column lives on the session row). The next
 *     session opens at DEFAULT_DBM (15) — the slider auto-pushes that
 *     value on mount when no override exists, so the slider's reading
 *     is always the actual reader power, never WMS steady-state.
 *
 * Visual: full slider track, "WMS default" hint when at max, dBm
 * value next to the slider.
 */

const MIN_DBM = 1;
const MAX_DBM = 33;
const DEFAULT_DBM = 15;
// Each PATCH triggers the supervisor to SIGTERM + respawn the reader
// binary at the new power. That cycle costs ~5 s in the happy path; if
// two kills overlap (cashier scrubs the slider), the on-exit backoff
// doubles and the WIZnet bridge starts leaking ghost TCP sessions,
// wedging the chip within a few drags. A long debounce lets the
// cashier scrub freely; only the value they SETTLE on hits the wire.
const DEBOUNCE_MS = 1500;

export function AntennaPowerSlider() {
  const [value, setValue] = useState<number>(DEFAULT_DBM);
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
        } else {
          // No override yet on this session — push DEFAULT_DBM so the
          // slider value is always the truth (reader runs at exactly
          // what the cashier sees) instead of WMS steady-state power.
          await fetch("/api/pos/hardware/reader/power", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ powerDbm: DEFAULT_DBM }),
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
