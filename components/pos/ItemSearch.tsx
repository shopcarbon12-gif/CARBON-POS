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
      <span
        className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-carbon-text-muted text-2xl pointer-events-none"
        aria-hidden
      >
        search
      </span>
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder="Scan a barcode or type any part of an item — SKU, UPC, name, color, size…"
        className="carbon-input tap-lg w-full pl-14 pr-4 py-4 text-xl font-semibold text-carbon-text"
        autoComplete="off"
      />
      {q && results.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-2 carbon-card shadow-lg max-h-[28rem] overflow-auto">
          <ul className="divide-y divide-carbon-border-soft">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(r);
                    setQ("");
                    setResults([]);
                  }}
                  className="w-full text-left p-4 hover:bg-[var(--carbon-surface-soft)] transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Image placeholder — Phase 2 wires the WMS media bucket. */}
                    <div className="w-16 h-16 bg-[var(--carbon-surface-soft)] border border-carbon-border-soft flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-carbon-text-muted text-2xl">
                        checkroom
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-lg font-bold text-carbon-text leading-snug truncate">
                        {r.item_name}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-sm">
                        <DetailField label="SKU">
                          <span className="font-mono font-semibold text-carbon-text">
                            {r.sku ?? "—"}
                          </span>
                        </DetailField>
                        <DetailField label="UPC">
                          <span className="font-mono font-semibold text-carbon-text">
                            {r.upc ?? "—"}
                          </span>
                        </DetailField>
                        <DetailField label="Color">
                          <span className="font-semibold text-carbon-text">
                            {r.color ?? "—"}
                          </span>
                        </DetailField>
                        <DetailField label="Size">
                          <span className="font-semibold text-carbon-text">
                            {r.size ?? "—"}
                          </span>
                        </DetailField>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base font-bold tabular-nums text-carbon-text">
                        {formatMoney(r.retail_price ?? 0)}
                      </div>
                      {typeof r.stock_count === "number" ? (
                        <StockChip n={r.stock_count} />
                      ) : null}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {q && !loading && results.length === 0 && (
        <div className="absolute z-10 left-0 right-0 mt-2 carbon-card px-4 py-6 text-center text-carbon-text-muted">
          No matches. Try fewer characters.
        </div>
      )}
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider font-bold text-carbon-text-muted shrink-0">
        {label}
      </span>
      <span className="truncate">{children}</span>
    </div>
  );
}

function StockChip({ n }: { n: number }) {
  const cls =
    n === 0
      ? "bg-red-50 text-red-800 ring-1 ring-red-600/30"
      : n <= 5
        ? "bg-amber-50 text-amber-900 ring-1 ring-amber-700/30"
        : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-700/30";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 mt-1 text-xs font-bold tabular-nums ${cls}`}
    >
      {n} in stock
    </span>
  );
}
