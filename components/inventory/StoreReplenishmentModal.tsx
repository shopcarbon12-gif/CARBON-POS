"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Store Replenishment — read-only window on the Products tab (Orlando
 * Warehouse only). Picking happens on the CarbonWMS handheld; here you only
 * watch each showroom sale: GREEN = replenished (every sold item that has
 * stock was ticked on the handheld), grey = still open.
 *
 * Same details as the handheld: day, then per sale the number and
 * time · customer · employee, with the items sold on the right. Tap a sale to
 * see its items: replenished (green, with who and when), still to pick
 * (grey) or out of stock (faded).
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

type Line = {
  lineId: number;
  sku: string | null;
  name: string;
  color: string | null;
  size: string | null;
  bin: string | null;
  soldQty: number;
  inStock: number;
  pickable: boolean;
  picked: boolean;
  pickedBy: string | null;
  pickedAt: string | null;
};

const REFRESH_MS = 15_000;

function SaleItems({ saleId, refreshTick }: { saleId: number; refreshTick: number }) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/pos/store-replenishment/${saleId}`, { cache: "no-store" })
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as { lines?: Line[]; error?: string };
        if (!res.ok) throw new Error(j.error ?? "Could not load the items");
        if (alive) {
          setLines(j.lines ?? []);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load the items"));
    return () => {
      alive = false;
    };
  }, [saleId, refreshTick]);

  if (error) return <p className="px-3 py-2 text-sm font-semibold text-red-600">{error}</p>;
  if (!lines) return <p className="px-3 py-2 text-sm text-[var(--color-pos-muted)]">Loading items…</p>;
  if (!lines.length) return <p className="px-3 py-2 text-sm text-[var(--color-pos-muted)]">No items on this sale.</p>;
  return (
    <ul className="divide-y divide-gray-200 border-t border-gray-200 bg-white">
      {lines.map((l) => {
        const tone = !l.pickable ? "opacity-50" : "";
        const when = l.pickedAt
          ? new Date(l.pickedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })
          : null;
        return (
          <li key={l.lineId} className={`flex items-center gap-3 px-3 py-2 ${tone}`}>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 text-sm font-black ${
                l.picked ? "border-green-600 bg-green-600 text-white" : "border-gray-400 bg-white text-transparent"
              }`}
              aria-label={l.picked ? "Replenished" : "Not replenished"}
            >
              ✓
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm font-bold">{l.sku ? `SKU ${l.sku}` : "No catalog item"}</div>
              <div className="truncate text-sm font-semibold uppercase">
                {[l.name, l.color, l.size].filter(Boolean).join(" · ")}
              </div>
              <div className="text-base font-black text-black">
                BIN {l.bin ?? "—"} · SOLD {l.soldQty}
              </div>
              <div className={`text-xs font-bold uppercase tracking-wider ${l.picked ? "text-green-700" : "text-gray-500"}`}>
                {!l.pickable
                  ? "Out of stock — nothing to pick"
                  : l.picked
                    ? `Replenished${l.pickedBy ? ` by ${l.pickedBy}` : ""}${when ? ` · ${when}` : ""}`
                    : "Not replenished yet"}
              </div>
            </div>
            <div className="w-14 shrink-0 text-center">
              <div className="text-xl font-black leading-none">{l.inStock}</div>
              <div className="text-[10px] font-bold tracking-wider text-gray-500">IN STOCK</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function StoreReplenishmentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openSale, setOpenSale] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

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
      setRefreshTick((t) => t + 1);
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
                        className={`overflow-hidden rounded-lg border ${
                          s.complete ? "border-green-600 bg-green-50" : "border-gray-300 bg-gray-100"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setOpenSale((cur) => (cur === s.id ? null : s.id))}
                          aria-expanded={openSale === s.id}
                          className="flex w-full items-stretch text-left"
                          title={openSale === s.id ? "Hide items" : "Show items"}
                        >
                        <div className={`w-1 shrink-0 ${s.complete ? "bg-green-600" : "bg-gray-400"}`} />
                        <div className="min-w-0 flex-1 px-3 py-2.5">
                          <div className="font-mono text-lg font-bold">
                            #{s.saleNumber}
                            <span className="ml-2 align-middle font-sans text-xs font-bold text-gray-500">
                              {openSale === s.id ? "▲ hide items" : "▼ items"}
                            </span>
                          </div>
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
                        </button>
                        {openSale === s.id ? <SaleItems saleId={s.id} refreshTick={refreshTick} /> : null}
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
