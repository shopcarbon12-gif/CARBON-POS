"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import type { SearchResultItem } from "./ItemSearch";

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "OS", "ONE SIZE"];

/** Numeric sizes ascending (28, 30, 32…), then letter sizes in fitting order. */
function sizeRank(s: string): [number, number, string] {
  const n = Number(s);
  if (Number.isFinite(n) && s.trim() !== "") return [0, n, s];
  const i = SIZE_ORDER.indexOf(s.trim().toUpperCase());
  return [1, i === -1 ? 999 : i, s];
}

/**
 * Color × size grid for one product: every variant with its stock at
 * this store. Tap a cell to add that exact SKU to the cart. Opened from
 * the grid button on an item-search result.
 */
export function MatrixPicker({
  skuId,
  onPick,
  onClose,
}: {
  skuId: string;
  onPick: (item: SearchResultItem) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    item_name: string;
    image_url: string | null;
    variants: SearchResultItem[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/pos/items/${skuId}/matrix`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setData(await r.json());
      })
      .catch(() => setError("Couldn't load this product's colors and sizes."));
  }, [skuId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grid = useMemo(() => {
    if (!data) return null;
    const colors = [...new Set(data.variants.map((v) => v.color ?? "—"))];
    const sizes = [...new Set(data.variants.map((v) => v.size ?? "—"))].sort((a, b) => {
      const [ga, na, sa] = sizeRank(a);
      const [gb, nb, sb] = sizeRank(b);
      return ga - gb || na - nb || sa.localeCompare(sb);
    });
    const cell = new Map(data.variants.map((v) => [`${v.color ?? "—"}|${v.size ?? "—"}`, v]));
    return { colors, sizes, cell };
  }, [data]);

  return (
    <div className="fixed inset-0 bg-black/55 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-white w-full max-w-4xl max-h-[90vh] overflow-auto p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            {data?.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.image_url} alt="" className="w-14 h-[74px] object-cover border border-carbon-border-soft" />
            )}
            <div className="min-w-0">
              <h2 className="text-xl font-bold truncate">{data?.item_name ?? "Loading…"}</h2>
              <p className="text-sm text-carbon-text-muted">
                Tap a color / size to add it. Numbers are units in stock here.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-2xl leading-none px-2 text-carbon-text-muted" aria-label="Close">
            ×
          </button>
        </div>
        {error && <p className="text-carbon-danger">{error}</p>}
        {grid && (
          <div className="overflow-x-auto">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white px-3 py-2 text-left text-xs uppercase tracking-wider text-carbon-text-muted">
                    Color / Size
                  </th>
                  {grid.sizes.map((sz) => (
                    <th key={sz} className="px-2 py-2 text-center font-bold min-w-[64px]">
                      {sz}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.colors.map((c) => (
                  <tr key={c} className="border-t border-carbon-border-soft">
                    <th className="sticky left-0 bg-white px-3 py-2 text-left font-semibold whitespace-nowrap">{c}</th>
                    {grid.sizes.map((sz) => {
                      const v = grid.cell.get(`${c}|${sz}`);
                      if (!v) return <td key={sz} className="px-1 py-1" />;
                      const n = v.stock_count ?? 0;
                      return (
                        <td key={sz} className="px-1 py-1">
                          <button
                            type="button"
                            onClick={() => onPick(v)}
                            title={`${v.sku ?? ""} · ${formatMoney(v.retail_price ?? 0)}`}
                            className={`w-full min-w-[56px] h-12 border font-bold tabular-nums transition-colors ${
                              n === 0
                                ? "border-carbon-border-soft text-carbon-text-muted bg-[var(--carbon-surface-soft)] hover:bg-red-50"
                                : n <= 2
                                  ? "border-amber-500 text-amber-900 bg-amber-50 hover:bg-amber-100"
                                  : "border-emerald-600 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                            }`}
                          >
                            {n}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
