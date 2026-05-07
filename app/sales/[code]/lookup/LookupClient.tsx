"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";

type SearchResult = {
  id: string;
  sku: string;
  upc: string | null;
  item_name: string;
  color: string | null;
  size: string | null;
  retail_price: string | null;
  bin: string | null;
};

type Detail = {
  sku: SearchResult;
  /** in-stock items at the active location. */
  in_stock: number;
  /** items in-transit *to* the active location. */
  in_transit: number;
  /** in-stock items at OTHER locations (so the cashier can see a transfer
   *  is possible without leaving Lookup). */
  elsewhere: number;
};

/**
 * Client-side lookup widget. Re-uses /api/pos/items/search for the type-ahead
 * and posts to the same endpoint that the sell-screen item search uses, then
 * fans out to a small bespoke /api/pos/items/[id]/lookup-detail call for
 * stock/in-transit numbers.
 */
export function LookupClient({
  locationId,
  code,
}: {
  locationId: string;
  code: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [picked, setPicked] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      const res = await fetch(`/api/pos/items/search?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) {
        setError("Search failed");
        return;
      }
      const data = (await res.json()) as { items: SearchResult[] };
      setResults(data.items ?? []);
    }, 200);
  }, [q]);

  async function pick(item: SearchResult) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pos/items/${encodeURIComponent(item.id)}/lookup-detail?locationId=${encodeURIComponent(locationId)}`,
      );
      if (!res.ok) {
        setError("Couldn't load stock for this item.");
        setPicked(null);
        return;
      }
      const data = (await res.json()) as Omit<Detail, "sku">;
      setPicked({ sku: item, ...data });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6 max-w-5xl">
      <div>
        <label className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted block mb-2">
          Search SKU, UPC, or product name
        </label>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. CJ-JKT-DIS-M"
          className="carbon-input tap w-full text-base"
        />

        <div className="mt-4 max-h-[60vh] overflow-y-auto border border-[var(--color-pos-border)]">
          {results.length === 0 ? (
            <p className="text-sm text-[var(--color-pos-muted)] p-6 text-center">
              {q.trim() ? "No matches." : "Start typing to search."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-pos-border)]">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => void pick(r)}
                    className="w-full text-left px-4 py-3 hover:bg-[var(--color-pos-bg)] transition-colors"
                  >
                    <div className="font-semibold">{r.item_name}</div>
                    <div className="text-xs text-[var(--color-pos-muted)] font-mono">
                      {r.sku}
                      {r.upc ? ` · UPC ${r.upc}` : ""}
                      {r.color || r.size
                        ? ` · ${[r.color, r.size].filter(Boolean).join(" ")}`
                        : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted mb-2">
          Details
        </p>
        {!picked ? (
          <div className="carbon-card p-8 text-center text-[var(--color-pos-muted)]">
            Pick a result on the left to see price + stock for this location.
          </div>
        ) : (
          <div className="carbon-card p-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold">{picked.sku.item_name}</h2>
              <p className="text-xs text-[var(--color-pos-muted)] font-mono mt-1">
                {picked.sku.sku}
                {picked.sku.upc ? ` · UPC ${picked.sku.upc}` : ""}
                {picked.sku.color || picked.sku.size
                  ? ` · ${[picked.sku.color, picked.sku.size]
                      .filter(Boolean)
                      .join(" ")}`
                  : ""}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-y-2">
              <dt className="text-[var(--color-pos-muted)]">Retail price</dt>
              <dd className="text-right font-semibold tabular-nums">
                {picked.sku.retail_price
                  ? formatMoney(picked.sku.retail_price)
                  : "—"}
              </dd>
              <dt className="text-[var(--color-pos-muted)]">In stock here</dt>
              <dd className="text-right font-semibold tabular-nums">
                {picked.in_stock}
              </dd>
              <dt className="text-[var(--color-pos-muted)]">
                In transit to this location
              </dt>
              <dd className="text-right font-semibold tabular-nums">
                {picked.in_transit}
              </dd>
              <dt className="text-[var(--color-pos-muted)]">At other locations</dt>
              <dd className="text-right font-semibold tabular-nums">
                {picked.elsewhere}
              </dd>
              {picked.sku.bin && (
                <>
                  <dt className="text-[var(--color-pos-muted)]">Bin (catalog)</dt>
                  <dd className="text-right font-mono">{picked.sku.bin}</dd>
                </>
              )}
            </dl>
            <div className="border-t border-[var(--color-pos-border)] pt-3">
              <Link
                href={`/sales/${code}/new?seed=${encodeURIComponent(picked.sku.sku)}`}
                className="carbon-btn-primary tap inline-flex items-center justify-center px-5 font-semibold"
              >
                Add to a new sale
              </Link>
            </div>
          </div>
        )}
        {error && <p className="text-carbon-danger text-sm mt-2">{error}</p>}
        {busy && <p className="text-carbon-text-muted text-sm mt-2">Loading…</p>}
      </div>
    </div>
  );
}
