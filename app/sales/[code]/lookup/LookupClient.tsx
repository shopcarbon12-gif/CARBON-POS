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
  stock_count?: number;
};

type SkuDetail = {
  sku: string;
  upc: string | null;
  item_name: string;
  brand: string | null;
  vendor: string | null;
  category: string | null;
  color: string | null;
  size: string | null;
  retail_price: string | null;
};

type LocationLine = {
  location_id: string;
  location_name: string;
  in_stock: number;
};

type Detail = {
  sku: SkuDetail;
  /** in-stock items at the active location. */
  in_stock: number;
  /** items in-transit *to* the active location. */
  in_transit: number;
  /** in-stock items at OTHER locations (sum of by_location). */
  elsewhere: number;
  by_location: LocationLine[];
};

/**
 * Lookup widget. Big, scannable type-ahead — every dropdown row shows
 * name + SKU + UPC + size + color in full so floor staff can pattern-match
 * at a glance without clicking. Picking a row loads price, stock here,
 * in-transit, and a per-location breakdown of where else this SKU is on
 * hand (so the staff can offer "we have one at Florida Mall").
 *
 * Image column is a placeholder hexagon for now — Phase 2 wires the WMS
 * media bucket once images live in the catalog.
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
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      const res = await fetch(
        `/api/pos/items/search?q=${encodeURIComponent(q.trim())}`,
      );
      setSearching(false);
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
        setError("Couldn't load details for this item.");
        setPicked(null);
        return;
      }
      const data = (await res.json()) as Detail & { sku: SkuDetail | null };
      // Fall back to the search-row fields if the detail endpoint somehow
      // returns a null sku (shouldn't, but defensive).
      const sku: SkuDetail = data.sku ?? {
        sku: item.sku,
        upc: item.upc,
        item_name: item.item_name,
        brand: null,
        vendor: null,
        category: null,
        color: item.color,
        size: item.size,
        retail_price: item.retail_price,
      };
      setPicked({
        sku,
        in_stock: data.in_stock,
        in_transit: data.in_transit,
        elsewhere: data.elsewhere,
        by_location: data.by_location ?? [],
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl">
      {/* Big, full-width search field. */}
      <label className="text-xs uppercase tracking-wider font-bold text-carbon-text mb-2 block">
        Search SKU, UPC, name, color, size, brand…
      </label>
      <div className="relative">
        <span
          className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-carbon-text-muted text-2xl"
          aria-hidden
        >
          search
        </span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type any part of an item — SKU, UPC, name, color, size…"
          className="carbon-input w-full pl-14 pr-4 py-4 text-xl font-semibold text-carbon-text"
        />
      </div>
      {error ? (
        <p className="text-carbon-danger text-sm mt-2">{error}</p>
      ) : null}

      {/* Results dropdown — large, single-column rows with all key fields
          inline so the cashier can scan without clicking each row. */}
      {q.trim() ? (
        <div className="mt-4 carbon-card overflow-hidden">
          {searching && results.length === 0 ? (
            <p className="text-base text-carbon-text-muted p-6 text-center">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="text-base text-carbon-text-muted p-6 text-center">
              No matches. Try fewer characters.
            </p>
          ) : (
            <ul className="divide-y divide-carbon-border-soft">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => void pick(r)}
                    className={`w-full text-left p-4 hover:bg-[var(--carbon-surface-soft)] transition-colors ${
                      picked?.sku.sku === r.sku
                        ? "bg-[var(--carbon-surface-soft)]"
                        : ""
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      {/* Image placeholder */}
                      <div className="w-16 h-16 bg-[var(--carbon-surface-soft)] border border-carbon-border-soft flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-carbon-text-muted text-2xl">
                          checkroom
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-lg font-bold text-carbon-text leading-snug">
                          {r.item_name}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-sm">
                          <DetailField label="SKU">
                            <span className="font-mono font-semibold text-carbon-text">
                              {r.sku}
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
                          {r.retail_price ? formatMoney(r.retail_price) : "—"}
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
          )}
        </div>
      ) : null}

      {/* Detail card — opens directly below the search results once the
          cashier picks a row. */}
      {picked ? (
        <div className="mt-6 carbon-card p-6">
          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
            {/* Image column (placeholder until WMS media is wired). */}
            <div className="aspect-square bg-[var(--carbon-surface-soft)] border border-carbon-border-soft flex items-center justify-center">
              <span className="material-symbols-outlined text-carbon-text-muted text-6xl">
                checkroom
              </span>
            </div>

            <div className="space-y-5">
              <div>
                <h2 className="text-2xl font-bold text-carbon-text">
                  {picked.sku.item_name}
                </h2>
                <p className="text-sm font-mono text-carbon-text-muted mt-1">
                  {picked.sku.sku}
                  {picked.sku.upc ? ` · UPC ${picked.sku.upc}` : ""}
                </p>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Spec label="Retail">
                  {picked.sku.retail_price
                    ? formatMoney(picked.sku.retail_price)
                    : "—"}
                </Spec>
                <Spec label="Color">{picked.sku.color ?? "—"}</Spec>
                <Spec label="Size">{picked.sku.size ?? "—"}</Spec>
                <Spec label="Category">{picked.sku.category ?? "—"}</Spec>
                <Spec label="Brand">{picked.sku.brand ?? "—"}</Spec>
                <Spec label="Vendor">{picked.sku.vendor ?? "—"}</Spec>
              </dl>

              {/* Stock summary — three big numbers. */}
              <div className="grid grid-cols-3 gap-3">
                <StockTile
                  label="In stock here"
                  n={picked.in_stock}
                  tone={picked.in_stock > 0 ? "good" : "bad"}
                />
                <StockTile
                  label="In transit to here"
                  n={picked.in_transit}
                  tone="info"
                />
                <StockTile
                  label="At other locations"
                  n={picked.elsewhere}
                  tone={picked.elsewhere > 0 ? "info" : "muted"}
                />
              </div>

              {/* Per-location breakdown — only show when there's something. */}
              {picked.by_location.length > 0 ? (
                <div>
                  <h3 className="text-xs uppercase tracking-wider font-bold text-carbon-text mb-2">
                    Available at other locations
                  </h3>
                  <ul className="divide-y divide-carbon-border-soft border border-carbon-border-soft">
                    {picked.by_location.map((row) => (
                      <li
                        key={row.location_id}
                        className="flex items-center justify-between px-4 py-3"
                      >
                        <span className="font-semibold text-carbon-text">
                          {row.location_name}
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 text-sm font-bold tabular-nums bg-emerald-50 text-emerald-800 ring-1 ring-emerald-700/30">
                          {row.in_stock}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2 border-t border-carbon-border-soft">
                <Link
                  href={`/sales/${code}/new?seed=${encodeURIComponent(picked.sku.sku)}`}
                  className="carbon-btn-primary tap inline-flex items-center justify-center px-5 font-semibold text-base"
                >
                  Add to a new sale
                </Link>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="carbon-btn-secondary tap inline-flex items-center justify-center px-5 font-semibold text-base"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : !q.trim() ? (
        <div className="mt-6 carbon-card p-10 text-center text-carbon-text-muted">
          <span
            className="material-symbols-outlined text-5xl text-carbon-text-muted/50 block mb-2"
            aria-hidden
          >
            search
          </span>
          Start typing to find an item. The dropdown shows name, SKU, UPC,
          color, and size for every match.
        </div>
      ) : null}

      {busy ? (
        <p className="text-sm text-carbon-text-muted mt-2">Loading details…</p>
      ) : null}
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

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider font-bold text-carbon-text-muted">
        {label}
      </dt>
      <dd className="text-base font-semibold text-carbon-text mt-0.5">
        {children}
      </dd>
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

function StockTile({
  label,
  n,
  tone,
}: {
  label: string;
  n: number;
  tone: "good" | "bad" | "info" | "muted";
}) {
  const cls = {
    good: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-700/30",
    bad: "bg-red-50 text-red-900 ring-1 ring-red-600/30",
    info: "bg-blue-50 text-blue-900 ring-1 ring-blue-700/30",
    muted:
      "bg-[var(--carbon-surface-soft)] text-carbon-text-muted ring-1 ring-carbon-border-soft",
  }[tone];
  return (
    <div className={`p-4 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider font-bold">{label}</p>
      <p className="text-3xl font-bold tabular-nums mt-1">{n}</p>
    </div>
  );
}
