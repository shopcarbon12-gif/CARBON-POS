"use client";

import { Trash2, Minus, Plus } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import type { CartLine } from "@/types/pos";

/**
 * Left-side cart per the carbon_sales_interface_active_cart_light reference.
 * Each row: title + EPC/SKU subtitle on the left, qty stepper + price + X
 * remove on the right.
 */
export function CartPanel({
  lines,
  onChangeQty,
  onRemove,
  onEditDiscount,
}: {
  lines: CartLine[];
  onChangeQty: (cartId: string, next: number) => void;
  onRemove: (cartId: string) => void;
  onEditDiscount: (cartId: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="carbon-card flex-1 flex flex-col min-h-[200px]">
        <div className="px-4 py-3 border-b border-[var(--carbon-border-soft)] text-xs uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
          Cart
        </div>
        <div className="flex-1 flex items-center justify-center p-10 text-center">
          <p className="text-[var(--carbon-muted)]">
            Scan a barcode or search for an item to start a sale.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="carbon-card overflow-hidden flex-1 flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--carbon-border-soft)] text-xs uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
        Cart
      </div>
      <div className="overflow-y-auto flex-1">
        <ul>
          {lines.map((line) => {
            const lineSubtotal = line.unit_price * line.quantity;
            const lineTotal = lineSubtotal - line.discount_amount;
            // Subtitle: SKU · UPC for product lines (no EPC, no price —
            // price already shows on the right). Misc/loyalty lines keep
            // their quantity/discount detail since they have no SKU/UPC.
            const idParts = line.line_type === "product"
              ? [
                  line.sku ? `SKU ${line.sku}` : null,
                  line.upc ? `UPC ${line.upc}` : null,
                ].filter(Boolean)
              : [];
            const miscMeta = line.line_type !== "product"
              ? [
                  line.quantity > 1
                    ? `${line.quantity} × ${formatMoney(line.unit_price)}`
                    : null,
                  line.discount_amount > 0
                    ? `−${formatMoney(line.discount_amount)} off`
                    : null,
                ].filter(Boolean)
              : [];
            const discountSuffix =
              line.line_type === "product" && line.discount_amount > 0
                ? `−${formatMoney(line.discount_amount)} off`
                : null;
            const subtitle = [
              ...idParts,
              ...miscMeta,
              discountSuffix,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={line.cart_id}
                className="flex items-center justify-between px-4 py-2 border-b border-[var(--carbon-border-soft)] last:border-b-0 hover:bg-[var(--carbon-surface-soft)] transition-colors"
              >
                {/* Thumbnail — bigger square (was w-14 h-14). Row vertical
                    padding dropped from py-4 → py-2 so the row height is
                    the same as before (image now dictates it). */}
                {line.line_type === "product" ? (
                  <div
                    className="w-20 h-20 shrink-0 mr-4 flex items-center justify-center bg-[var(--carbon-surface-soft)] border border-[var(--carbon-border-soft)]"
                    aria-hidden
                  >
                    <span className="material-symbols-outlined text-[40px] text-[var(--carbon-muted)]">
                      checkroom
                    </span>
                  </div>
                ) : null}
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold truncate">
                      {line.description}
                    </h3>
                    {line.source === "manual" && line.line_type === "product" ? (
                      // Foundation badge — color tinted by the
                      // expected-mode rules WMS will add later. Default
                      // for now: orange ("manually added, ambiguous").
                      // When `expected_mode` lands on the catalog row,
                      // swap to red (expected rfid → added manual) or
                      // green (expected manual → added manual).
                      <span
                        className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200"
                        title="Added manually (foundation — WMS-driven coloring still to come)"
                      >
                        Manual
                      </span>
                    ) : null}
                  </div>
                  {subtitle && (
                    <p className="text-sm text-carbon-text font-medium mt-1 truncate">
                      {subtitle}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                  {line.line_type === "product" ? (
                    line.source === "rfid" ? (
                      // RFID-stacked rows: qty equals the EPC count and
                      // can't be edited with +/-. Each tag is a unique
                      // physical item. Removing the row drops all EPCs
                      // in this stack.
                      <span
                        className="inline-flex items-center justify-center min-w-[3rem] px-3 py-1 border border-[var(--carbon-border)] bg-carbon-surface-soft text-carbon-text font-semibold tabular-nums"
                        title="Quantity follows the scanned tags — adjust by scanning more or removing the row."
                      >
                        {line.quantity}
                      </span>
                    ) : (
                      <div className="flex items-center border border-[var(--carbon-border)] bg-white">
                        <button
                          type="button"
                          onClick={() =>
                            onChangeQty(
                              line.cart_id,
                              Math.max(1, line.quantity - 1),
                            )
                          }
                          aria-label="Decrease quantity"
                          className="px-3 py-1 text-[var(--carbon-muted)] hover:bg-[var(--carbon-surface-soft)] transition-colors"
                        >
                          <Minus size={16} />
                        </button>
                        <span className="px-3 py-1 font-medium border-x border-[var(--carbon-border)] min-w-[2.5rem] text-center tabular-nums">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => onChangeQty(line.cart_id, line.quantity + 1)}
                          aria-label="Increase quantity"
                          className="px-3 py-1 text-[var(--carbon-muted)] hover:bg-[var(--carbon-surface-soft)] transition-colors"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    )
                  ) : (
                    <span className="text-xs text-[var(--carbon-muted)] uppercase tracking-wider font-bold">
                      Misc
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onEditDiscount(line.cart_id)}
                    className="text-right w-24 font-semibold tabular-nums hover:text-carbon-blue"
                    title="Click to apply a line discount"
                  >
                    {formatMoney(lineTotal)}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(line.cart_id)}
                    aria-label="Remove item"
                    className="text-[var(--carbon-muted)] hover:text-carbon-danger transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
