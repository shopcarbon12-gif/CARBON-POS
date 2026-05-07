"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";

export type SearchResultItem = {
  id: string;
  sku: string | null;
  upc: string | null;
  item_name: string;
  color: string | null;
  size: string | null;
  retail_price: string | null;
  /** Units in stock at the active location (0 = out of stock). */
  stock_count?: number;
};

/**
 * Auto-focused search box. Barcode scanners type fast and end with Enter,
 * so we treat an Enter press as "pick the first result". A short debounce
 * keeps the network quiet during keyboard typing.
 */
export function ItemSearch({
  onPick,
}: {
  onPick: (item: SearchResultItem) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length === 0) {
      setResults([]);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/pos/items/search?q=${encodeURIComponent(term)}`,
          { signal: ctrl.signal },
        );
        const data = await res.json();
        setResults(data.items ?? []);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 80);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q]);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const first = results[0];
    if (first) {
      onPick(first);
      setQ("");
      setResults([]);
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder="Scan a barcode or type to search…"
        className="tap-lg w-full rounded-2xl border border-[var(--color-pos-border)] bg-white px-5 text-lg"
        autoComplete="off"
      />
      {q && results.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-2 bg-white border border-[var(--color-pos-border)] rounded-2xl shadow-lg max-h-80 overflow-auto">
          {results.map((r) => {
            const stock = r.stock_count ?? 0;
            const stockLabel =
              stock === 0
                ? "Out of stock"
                : stock <= 5
                  ? `${stock} in stock`
                  : `${stock} in stock`;
            const stockCls =
              stock === 0
                ? "text-red-700"
                : stock <= 5
                  ? "text-amber-700"
                  : "text-emerald-700";
            return (
              <button
                key={r.id}
                onClick={() => {
                  onPick(r);
                  setQ("");
                  setResults([]);
                }}
                className="w-full text-left px-4 py-3 hover:bg-[var(--color-pos-bg)] border-b border-[var(--color-pos-border)] last:border-b-0"
              >
                <div className="flex justify-between">
                  <span className="font-medium truncate pr-3">
                    {r.item_name}
                  </span>
                  <span className="font-semibold tabular-nums shrink-0">
                    {formatMoney(r.retail_price ?? 0)}
                  </span>
                </div>
                <div className="text-xs text-[var(--color-pos-muted)] flex justify-between gap-3 mt-0.5">
                  <span className="truncate">
                    {[r.color, r.size, r.sku].filter(Boolean).join(" · ")}
                    {r.upc ? ` · ${r.upc}` : ""}
                  </span>
                  <span className={`font-bold uppercase tracking-wider tabular-nums shrink-0 ${stockCls}`}>
                    {stockLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {q && !loading && results.length === 0 && (
        <div className="absolute z-10 left-0 right-0 mt-2 bg-white border border-[var(--color-pos-border)] rounded-2xl px-4 py-3 text-[var(--color-pos-muted)]">
          No items match. Check the barcode and try again.
        </div>
      )}
    </div>
  );
}
