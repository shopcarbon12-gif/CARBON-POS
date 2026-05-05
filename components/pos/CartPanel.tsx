"use client";

import { Trash2, Minus, Plus } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import type { CartLine } from "@/types/pos";

/**
 * Left panel of the sell screen — the cart. One row per CartLine.
 * - Qty stepper for products.
 * - Click the price to edit a line discount.
 * - Trash button to remove a line.
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
      <div className="bg-white border border-[--color-pos-border] rounded-2xl p-10 text-center">
        <p className="text-[--color-pos-muted]">
          Scan a barcode or search for an item to start a sale.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-[--color-pos-border] rounded-2xl overflow-hidden">
      <ul>
        {lines.map((line) => {
          const lineSubtotal = line.unit_price * line.quantity;
          const lineTotal = lineSubtotal - line.discount_amount;
          return (
            <li
              key={line.cart_id}
              className="flex items-center gap-3 px-4 py-3 border-b border-[--color-pos-border] last:border-b-0"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{line.description}</p>
                <p className="text-xs text-[--color-pos-muted]">
                  {formatMoney(line.unit_price)} each
                  {line.discount_amount > 0 && (
                    <>
                      {" · "}
                      <button
                        onClick={() => onEditDiscount(line.cart_id)}
                        className="text-[--color-pos-accent-2] underline"
                      >
                        −{formatMoney(line.discount_amount)} off
                      </button>
                    </>
                  )}
                </p>
              </div>
              {line.line_type === "product" && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      onChangeQty(line.cart_id, Math.max(1, line.quantity - 1))
                    }
                    className="tap w-12 rounded-lg border border-[--color-pos-border] flex items-center justify-center"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={18} />
                  </button>
                  <span className="w-8 text-center font-semibold">
                    {line.quantity}
                  </span>
                  <button
                    onClick={() => onChangeQty(line.cart_id, line.quantity + 1)}
                    className="tap w-12 rounded-lg border border-[--color-pos-border] flex items-center justify-center"
                    aria-label="Increase quantity"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              )}
              <div className="w-24 text-right">
                <button
                  onClick={() => onEditDiscount(line.cart_id)}
                  className="font-semibold text-lg"
                >
                  {formatMoney(lineTotal)}
                </button>
              </div>
              <button
                onClick={() => onRemove(line.cart_id)}
                className="tap w-12 rounded-lg text-[--color-pos-muted] hover:text-[--color-pos-danger] flex items-center justify-center"
                aria-label="Remove item"
              >
                <Trash2 size={18} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
