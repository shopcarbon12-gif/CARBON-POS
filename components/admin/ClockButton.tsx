"use client";

import { useCallback, useEffect, useState } from "react";

type Status = { open: { id: number; clock_in: string } | null; today_minutes: number };

/**
 * Top-bar clock in / clock out for the signed-in employee. Shows how long
 * the current shift has run; clicking while on the clock asks before
 * clocking out. Hours land in Reports → Employee Hours.
 */
export function ClockButton() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const r = await fetch("/api/pos/clock").catch(() => null);
    if (r?.ok) setStatus((await r.json()) as Status);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(action: "in" | "out") {
    setBusy(true);
    const r = await fetch("/api/pos/clock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    setBusy(false);
    setConfirmOut(false);
    if (r?.ok) setStatus((await r.json()) as Status);
    else await load();
  }

  if (!status) return null;

  if (!status.open) {
    return (
      <button
        type="button"
        onClick={() => void act("in")}
        disabled={busy}
        className="hidden sm:flex items-center gap-1.5 h-9 px-3 border border-carbon-border text-sm font-semibold text-carbon-text hover:bg-[var(--carbon-surface-soft)] disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden>
          schedule
        </span>
        Clock in
      </button>
    );
  }

  const mins = Math.max(0, Math.floor((now - new Date(status.open.clock_in).getTime()) / 60000));
  const label = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;

  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setConfirmOut((v) => !v)}
        className="flex items-center gap-2 h-9 px-3 border border-emerald-600 text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
        title="You're clocked in — click to clock out"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-600" aria-hidden />
        On the clock · {label}
      </button>
      {confirmOut && (
        <div className="absolute right-0 top-11 z-50 w-56 bg-white border border-carbon-border shadow-lg p-3 text-sm">
          <p className="mb-3">Clock out now? You&apos;ve worked {label} this shift.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void act("out")}
              disabled={busy}
              className="flex-1 carbon-btn-primary h-9 font-semibold disabled:opacity-50"
            >
              {busy ? "…" : "Clock out"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOut(false)}
              className="flex-1 carbon-btn-secondary h-9 font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
