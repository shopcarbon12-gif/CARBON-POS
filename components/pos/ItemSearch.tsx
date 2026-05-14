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
  /** Matrices.is_manual_only — true when the catalog marks this item
   *  as non-RFID (no tag expected). Drives the cart Manual badge
   *  color: green when added manually as expected, red when an
   *  RFID-mode item slipped in via manual entry. */
  is_manual_only?: boolean;
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
      {/* Icon + input as flex siblings (NOT absolutely-positioned overlay)
          because `.carbon-input` declares `padding: 0 12px` as shorthand,
          which silently wins over Tailwind's pl-* utility and collapsed
          the icon on top of the typed text. */}
      <div className="carbon-input tap-lg w-full flex items-center gap-3 pl-4 pr-2 py-2">
        <span
          className="material-symbols-outlined text-carbon-text-muted text-2xl shrink-0"
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
          className="flex-1 bg-transparent border-0 outline-none p-0 text-xl font-semibold text-carbon-text placeholder:text-carbon-text-muted/70"
          autoComplete="off"
        />
      </div>
      {q && results.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-2 carbon-card shadow-lg max-h-[28rem] overflow-auto">
          <table className="w-full text-base text-carbon-text border-collapse">
            <thead>
              {/* Sticky header row — stays visible while the body
                  scrolls so column meaning never gets lost. */}
              <tr className="sticky top-0 z-10 bg-[var(--carbon-surface-soft)] text-xs uppercase tracking-wider font-bold text-carbon-text shadow-[0_1px_0_0_var(--carbon-border-soft)]">
                <th className="text-left  px-4 py-3">Item</th>
                <th className="text-left  px-4 py-3">SKU</th>
                <th className="text-left  px-4 py-3">UPC</th>
                <th className="text-left  px-4 py-3">Color</th>
                <th className="text-left  px-4 py-3">Size</th>
                <th className="text-right px-4 py-3">Price</th>
                <th className="text-right px-4 py-3">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-carbon-border-soft">
              {results.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => {
                    onPick(r);
                    setQ("");
                    setResults([]);
                  }}
                  className="hover:bg-[var(--carbon-surface-soft)] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 font-bold text-carbon-text">
                    {r.item_name}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-carbon-text">
                    {r.sku ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-carbon-text">
                    {r.upc ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-semibold text-carbon-text">
                    {r.color ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-semibold text-carbon-text">
                    {r.size ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-carbon-text">
                    {formatMoney(r.retail_price ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {typeof r.stock_count === "number" ? (
                      <StockChip n={r.stock_count} />
                    ) : (
                      <span className="text-carbon-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
