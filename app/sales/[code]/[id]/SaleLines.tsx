"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/utils";
import { ItemStockModal } from "@/components/pos/ItemStockModal";

export type SaleLineRow = {
  id: number;
  sku_id: string | null;
  epc: string | null;
  epcs: string[] | null;
  description: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  line_total: string;
  returned_qty: number;
  damaged_qty: number;
};

/**
 * Items table on the order screen. Tapping a row (or one of its tags)
 * opens the item's stock popup.
 */
export function SaleLines({ code, lines }: { code: string; lines: SaleLineRow[] }) {
  const [open, setOpen] = useState<{ sku: string | null; epc: string | null; description: string } | null>(null);

  return (
    <>
      <table className="w-full text-sm border border-[var(--color-pos-border)]">
        <thead className="bg-[var(--color-pos-bg)]">
          <tr className="text-left">
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">Unit</th>
            <th className="px-3 py-2 text-right">Discount</th>
            <th className="px-3 py-2 text-right">Tax</th>
            <th className="px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const tags = (l.epcs?.length ? l.epcs : l.epc ? [l.epc] : []) as string[];
            const clickable = !!(l.sku_id || tags.length);
            return (
              <tr
                key={l.id}
                onClick={() =>
                  clickable && setOpen({ sku: l.sku_id, epc: tags[0] ?? null, description: l.description })
                }
                className={`border-t border-[var(--color-pos-border)] ${clickable ? "cursor-pointer hover:bg-[var(--color-pos-bg)]" : ""}`}
                title={clickable ? "View stock" : undefined}
              >
                <td className="px-3 py-2">
                  <span className="font-medium">{l.description}</span>
                  {clickable && (
                    <span className="material-symbols-outlined text-[16px] align-middle ml-1.5 text-carbon-text-muted" aria-hidden>
                      inventory_2
                    </span>
                  )}
                  {l.returned_qty > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800">
                      {l.returned_qty >= l.quantity ? "Returned" : `${l.returned_qty} returned`}
                    </span>
                  )}
                  {l.damaged_qty > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs font-semibold bg-red-50 text-red-800">
                      {l.damaged_qty === 1 && l.quantity === 1 ? "Damaged" : `${l.damaged_qty} damaged`}
                    </span>
                  )}
                  {tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen({ sku: l.sku_id, epc: t, description: l.description });
                      }}
                      className="block text-xs font-mono text-[var(--color-pos-muted)] hover:underline text-left"
                    >
                      EPC {t}
                    </button>
                  ))}
                </td>
                <td className="px-3 py-2 text-right">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.unit_price)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(l.discount_amount) > 0 ? `-${formatMoney(l.discount_amount)}` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.tax_amount)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(l.line_total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-carbon-text-muted mt-1.5">Tap an item to see its stock and tag history.</p>
      {open && (
        <ItemStockModal
          code={code}
          skuId={open.sku}
          epc={open.epc}
          description={open.description}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
