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
            const subtitle = [
              line.epc ? `EPC ${line.epc}` : null,
              line.line_type === "product" && line.quantity > 1
                ? `${line.quantity} × ${formatMoney(line.unit_price)}`
                : null,
              line.discount_amount > 0
                ? `−${formatMoney(line.discount_amount)} off`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={line.cart_id}
                className="flex items-center justify-between px-4 py-4 border-b border-[var(--carbon-border-soft)] last:border-b-0 hover:bg-[var(--carbon-surface-soft)] transition-colors"
              >
                {/* Thumbnail tile — placeholder gray box with a shirt icon.
                    Hidden on misc/loyalty lines since there's no product. */}
                {line.line_type === "product" ? (
                  <div
                    className="w-14 h-14 shrink-0 mr-4 flex items-center justify-center bg-[var(--carbon-surface-soft)] border border-[var(--carbon-border-soft)]"
                    aria-hidden
                  >
                    <span className="material-symbols-outlined text-[28px] text-[var(--carbon-muted)]">
                      checkroom
                    </span>
                  </div>
                ) : null}
                <div className="flex-1 min-w-0 pr-4">
                  <h3 className="text-base font-semibold truncate">
                    {line.description}
                  </h3>
                  <p className="text-xs text-[var(--carbon-muted)] mt-1 truncate">
                    {subtitle ||
                      (line.line_type === "product"
                        ? formatMoney(line.unit_price)
                        : "")}
                  </p>
                </div>
                <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                  {line.line_type === "product" ? (
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
