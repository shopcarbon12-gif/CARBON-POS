"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Store Replenishment — read-only window on the Products tab (Orlando
 * Warehouse only). Picking happens on the CarbonWMS handheld; here you only
 * watch each showroom sale: GREEN = replenished (every sold item that has
 * stock was ticked on the handheld), grey = still open.
 *
 * Same details as the handheld: day, then per sale the number and
 * time · customer · employee, with the items sold on the right.
 * Today by default; pick a date range at the top. Refreshes every 15 s.
 */
type Sale = {
  id: number;
  saleNumber: string;
  localDay: string;
  localTime: string;
  employee: string | null;
  customer: string | null;
  soldQty: number;
  pickableLines: number;
  pickedLines: number;
  complete: boolean;
};

const REFRESH_MS = 15_000;

export function StoreReplenishmentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (fromDate) sp.set("fromDate", fromDate);
      if (toDate || fromDate) sp.set("toDate", toDate || fromDate);
      const res = await fetch(`/api/pos/store-replenishment?${sp.toString()}`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { sales?: Sale[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? "Could not load replenishment");
      setSales(j.sales ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load replenishment");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    if (!open) return;
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, load, onClose]);

  if (!open) return null;

  const done = (sales ?? []).filter((s) => s.complete).length;
  const rangeLabel = !fromDate ? "Today" : !toDate || toDate === fromDate ? fromDate : `${fromDate} – ${toDate}`;

  // Group by the store-local day the server sends (newest first already).
  const groups: { day: string; rows: Sale[] }[] = [];
  for (const s of sales ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.day === s.localDay) last.rows.push(s);
    else groups.push({ day: s.localDay, rows: [s] });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-2xl p-6 shadow-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-2 gap-3">
          <h2 className="text-xl font-bold shrink-0">Store Replenishment</h2>
          <button onClick={onClose} className="text-[var(--color-pos-muted)] text-xl leading-none px-2" aria-label="Close">
            ×
          </button>
        </div>
        <p className="text-[var(--color-pos-muted)] mb-3">
          Showroom sales being refilled from the back on the CarbonWMS handheld.{" "}
          <span className="font-semibold text-green-700">Green</span> = replenished, grey = still open. View only.
        </p>

        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-pos-muted)]">
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="carbon-input tap px-3 py-1.5 text-base font-semibold"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-pos-muted)]">
            To
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="carbon-input tap px-3 py-1.5 text-base font-semibold"
            />
          </label>
          {fromDate || toDate ? (
            <button
              type="button"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
              className="carbon-btn-ghost tap px-3 font-semibold"
            >
              Today
            </button>
          ) : null}
          <div className="ml-auto text-right">
            <div className="text-lg font-black">{rangeLabel.toUpperCase()}</div>
            <div className="text-lg font-black">
              DONE {done} / {(sales ?? []).length}
            </div>
          </div>
        </div>

        {error ? <p className="mb-2 text-sm font-semibold text-red-600">{error}</p> : null}

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {sales === null ? (
            <p className="py-10 text-center text-[var(--color-pos-muted)]">{loading ? "Loading…" : ""}</p>
          ) : sales.length === 0 ? (
            <p className="py-10 text-center text-[var(--color-pos-muted)]">No showroom sales in this date range.</p>
          ) : (
            groups.map((g) => (
              <div key={g.day} className="mb-4">
                <div className="mb-2 text-base font-black tracking-wide text-black">{g.day}</div>
                <ul className="flex flex-col gap-2">
                  {g.rows.map((s) => {
                    const people = [s.localTime, s.customer ?? "No customer", s.employee ?? "No employee"].join(" · ");
                    const status =
                      s.pickableLines === 0
                        ? "Nothing in stock to pick"
                        : s.complete
                          ? `Replenished · ${s.pickedLines} / ${s.pickableLines}`
                          : `Open · picked ${s.pickedLines} / ${s.pickableLines}`;
                    return (
                      <li
                        key={s.id}
                        className={`flex items-stretch overflow-hidden rounded-lg border ${
                          s.complete ? "border-green-600 bg-green-50" : "border-gray-300 bg-gray-100"
                        }`}
                      >
                        <div className={`w-1 shrink-0 ${s.complete ? "bg-green-600" : "bg-gray-400"}`} />
                        <div className="min-w-0 flex-1 px-3 py-2.5">
                          <div className="font-mono text-lg font-bold">#{s.saleNumber}</div>
                          <div className="text-sm font-bold uppercase">{people}</div>
                          <div className={`text-xs font-bold uppercase tracking-wider ${s.complete ? "text-green-700" : "text-gray-500"}`}>
                            {status}
                          </div>
                        </div>
                        <div
                          className={`flex w-20 shrink-0 flex-col items-center justify-center text-white ${
                            s.complete ? "bg-green-600" : "bg-gray-500"
                          }`}
                        >
                          <span className="text-2xl font-black leading-none">{s.soldQty}</span>
                          <span className="mt-1 text-[10px] font-bold tracking-wider">SOLD</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
