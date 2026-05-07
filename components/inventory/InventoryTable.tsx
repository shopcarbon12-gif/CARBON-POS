"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";

type SortKey =
  | "item_name"
  | "color"
  | "size"
  | "upc"
  | "sku"
  | "stock"
  | "price";

const LOW_STOCK_THRESHOLD = 5;

const SORT_LABELS: Record<SortKey, string> = {
  item_name: "Item Name",
  color: "Color",
  size: "Size",
  upc: "UPC",
  sku: "SKU",
  stock: "Stock",
  price: "Price",
};

export type Row = {
  id: string;
  sku: string;
  upc: string | null;
  item_name: string;
  category: string | null;
  color: string | null;
  size: string | null;
  retail_price: string | null;
  stock_count: number;
  /** Optional product image URL when one is attached. */
  image_url: string | null;
};

/**
 * Client-side inventory table. Owns:
 *   - live partial search (debounced; results render directly in the table,
 *     no dropdown);
 *   - sortable A→Z / Z→A column headers;
 *   - clickable image cell that opens a popup with the product photo
 *     (or a "picture not available" placeholder when none is attached);
 *   - pagination via `page` / `totalPages` props.
 *
 * The server still does the first paint with `initialRows`; the client
 * takes over once the user starts typing or paging.
 */
export function InventoryTable({
  code,
  initialRows,
  initialQ,
  initialSort,
  initialDir,
  initialPage,
  pageSize,
  initialTotal,
}: {
  code: string;
  initialRows: Row[];
  initialQ: string;
  initialSort: SortKey;
  initialDir: "asc" | "desc";
  initialPage: number;
  pageSize: number;
  initialTotal: number;
}) {
  const [q, setQ] = useState(initialQ);
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [dir, setDir] = useState<"asc" | "desc">(initialDir);
  const [page, setPage] = useState(initialPage);
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Row | null>(null);
  const debounceRef = useRef<number | null>(null);
  // Ignore the very first effect run — the server already did the first
  // paint, so re-fetching would just duplicate work.
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void load();
    }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, dir, page]);

  async function load() {
    setLoading(true);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    sp.set("sort", sort);
    sp.set("dir", dir);
    sp.set("page", String(page));
    const res = await fetch(`/api/pos/inventory?${sp.toString()}`);
    setLoading(false);
    if (!res.ok) return;
    const data = (await res.json()) as { rows: Row[]; total: number };
    setRows(data.rows ?? []);
    setTotal(data.total ?? 0);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const showFrom = total === 0 ? 0 : offset + 1;
  const showTo = Math.min(offset + rows.length, total);

  const onSortClick = (k: SortKey) => {
    setPage(1);
    if (sort === k) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(k);
      setDir("asc");
    }
  };

  return (
    <>
      {/* Page header — single search input, no Size, no Filter button.
          Typing filters the table live (debounced). */}
      <div className="flex flex-wrap justify-between items-end gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Product Management
          </h2>
          <p className="text-sm text-carbon-text-muted mt-1">
            Live catalog view scoped to this location. Stock counts come from
            RFID-tagged inventory in WMS.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="relative">
            <span
              className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-carbon-text-muted"
              aria-hidden
            >
              search
            </span>
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
              placeholder="Search SKU, UPC, name, color, size, brand…"
              className="carbon-input tap w-80 pl-10 pr-3 text-base font-semibold text-carbon-text"
            />
          </div>
          <span
            title="Catalog is sourced from CarbonWMS — add SKUs there."
            className="carbon-btn-primary tap px-4 font-semibold flex items-center gap-2 cursor-not-allowed opacity-90"
            aria-disabled
          >
            <span className="material-symbols-outlined text-base">add</span>
            <span>Add Product</span>
          </span>
        </div>
      </div>

      <div className="carbon-card overflow-x-auto">
        <table className="w-full min-w-[1200px] text-sm border-collapse">
          <thead>
            <tr className="bg-[var(--carbon-surface-soft)] border-b border-carbon-border-soft text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted">
              <th className="text-right px-3 py-3 w-12">#</th>
              <th className="text-left px-3 py-3 w-20">Image</th>
              <SortHeader keyName="item_name" align="left"  active={sort === "item_name"} dir={dir} onClick={onSortClick} />
              <SortHeader keyName="color"     align="left"  active={sort === "color"}     dir={dir} onClick={onSortClick} />
              <SortHeader keyName="size"      align="left"  active={sort === "size"}      dir={dir} onClick={onSortClick} />
              <SortHeader keyName="upc"       align="left"  active={sort === "upc"}       dir={dir} onClick={onSortClick} />
              <SortHeader keyName="sku"       align="left"  active={sort === "sku"}       dir={dir} onClick={onSortClick} />
              <SortHeader keyName="stock"     align="left"  active={sort === "stock"}     dir={dir} onClick={onSortClick} />
              <SortHeader keyName="price"     align="right" active={sort === "price"}     dir={dir} onClick={onSortClick} />
              <th className="text-center px-3 py-3 w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-carbon-border-soft">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-carbon-text-muted"
                >
                  {loading ? "Loading…" : "No products match your search."}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const stock = row.stock_count;
                const pillCls =
                  stock === 0
                    ? "bg-red-50 text-red-800 ring-1 ring-red-600/30"
                    : stock <= LOW_STOCK_THRESHOLD
                      ? "bg-amber-50 text-amber-900 ring-1 ring-amber-700/30"
                      : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-700/30";
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-[var(--carbon-surface-soft)] transition-colors ${
                      stock === 0 ? "opacity-75" : ""
                    }`}
                  >
                    <td className="px-3 py-3 text-right tabular-nums text-carbon-text-muted">
                      {showFrom + idx}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setPicked(row)}
                        title={
                          row.image_url
                            ? "View product image"
                            : "No image attached — tap to confirm"
                        }
                        className="w-12 h-12 bg-[var(--carbon-surface-soft)] border border-carbon-border-soft flex items-center justify-center hover:border-carbon-blue transition-colors overflow-hidden"
                      >
                        {row.image_url ? (
                          // Plain <img> so we don't pin Next/Image config to
                          // a specific remote pattern.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.image_url}
                            alt={row.item_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="material-symbols-outlined text-carbon-text-muted text-lg">
                            checkroom
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-3 font-semibold text-carbon-text">
                      {row.item_name}
                    </td>
                    <td className="px-3 py-3 text-carbon-text">
                      {row.color ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-carbon-text">
                      {row.size ?? "—"}
                    </td>
                    <td className="px-3 py-3 font-mono text-sm font-medium text-carbon-text">
                      {row.upc ?? "—"}
                    </td>
                    <td className="px-3 py-3 font-mono text-sm font-medium text-carbon-text">
                      {row.sku}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 text-sm font-bold tabular-nums ${pillCls}`}
                      >
                        {stock}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-base font-semibold text-right tabular-nums text-carbon-text">
                      {row.retail_price ? formatMoney(row.retail_price) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-center gap-2">
                        <Link
                          href={`/sales/${code}/lookup?q=${encodeURIComponent(row.sku)}`}
                          className="text-carbon-text-muted hover:text-carbon-blue transition-colors"
                          title="Lookup details"
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            visibility
                          </span>
                        </Link>
                        <Link
                          href={`/sales/${code}/new?seed=${encodeURIComponent(row.sku)}`}
                          className="text-carbon-text-muted hover:text-carbon-blue transition-colors"
                          title="Add to a new sale"
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            add_shopping_cart
                          </span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="p-4 border-t border-carbon-border-soft flex items-center justify-between flex-wrap gap-3">
          <p className="text-xs text-carbon-text-muted">
            {loading
              ? "Loading…"
              : `Showing ${showFrom}–${showTo} of ${total.toLocaleString()} products`}
          </p>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </div>
      </div>

      {picked ? (
        <ImagePopup row={picked} onClose={() => setPicked(null)} />
      ) : null}
    </>
  );
}

function SortHeader({
  keyName,
  align,
  active,
  dir,
  onClick,
}: {
  keyName: SortKey;
  align: "left" | "right";
  active: boolean;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
}) {
  const arrow = active ? (dir === "asc" ? "↑" : "↓") : "↕";
  return (
    <th className={`px-3 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onClick(keyName)}
        className={`inline-flex items-center gap-1 hover:text-carbon-blue transition-colors ${
          active ? "text-carbon-blue" : ""
        }`}
        title={`Sort by ${SORT_LABELS[keyName]} ${active && dir === "asc" ? "Z–A" : "A–Z"}`}
      >
        <span>{SORT_LABELS[keyName]}</span>
        <span aria-hidden className={`text-[10px] ${active ? "" : "opacity-40"}`}>
          {arrow}
        </span>
      </button>
    </th>
  );
}

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onPage(prev)}
        disabled={page === 1}
        className="px-3 py-1 border border-carbon-border-soft text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted hover:bg-[var(--carbon-surface-soft)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Prev
      </button>
      {pages.map((p) => (
        <button
          type="button"
          key={p}
          onClick={() => onPage(p)}
          className={`px-3 py-1 border text-[11px] uppercase tracking-wider font-bold ${
            p === page
              ? "border-carbon-blue bg-[var(--carbon-blue-soft)] text-carbon-blue"
              : "border-carbon-border-soft text-carbon-text-muted hover:bg-[var(--carbon-surface-soft)]"
          }`}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPage(next)}
        disabled={page === totalPages}
        className="px-3 py-1 border border-carbon-border-soft text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted hover:bg-[var(--carbon-surface-soft)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Next
      </button>
    </div>
  );
}

function ImagePopup({ row, onClose }: { row: Row; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white max-w-2xl w-full p-6 shadow-xl border border-carbon-border-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-carbon-text truncate">
              {row.item_name}
            </h2>
            <p className="text-xs text-carbon-text-muted font-mono mt-0.5">
              {row.sku}
              {row.upc ? ` · UPC ${row.upc}` : ""}
              {row.color || row.size
                ? ` · ${[row.color, row.size].filter(Boolean).join(" ")}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-carbon-text-muted hover:text-carbon-text text-2xl leading-none px-2 shrink-0"
          >
            ×
          </button>
        </div>
        <div className="aspect-square w-full bg-[var(--carbon-surface-soft)] border border-carbon-border-soft flex items-center justify-center overflow-hidden">
          {row.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.image_url}
              alt={row.item_name}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-carbon-text-muted">
              <span className="material-symbols-outlined text-7xl opacity-50">
                hide_image
              </span>
              <p className="text-base font-semibold">Picture not available</p>
              <p className="text-xs">
                No image is attached to this product in the catalog.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
