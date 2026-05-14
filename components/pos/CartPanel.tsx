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
                {/* Mode badge — sits to the LEFT of the description so
                    every row aligns to a fixed-width 64×22 pill.
                      • RFID source            → green RFID
                      • Manual src + catalog is_manual_only=true → green MANUAL
                      • Manual src + catalog is_manual_only=false → red MANUAL
                    Style mirrors the EPCs button on /inventory/catalog
                    in WMS. */}
                {line.line_type === "product" ? (
                  <ModeBadge
                    source={line.source ?? "manual"}
                    isManualOnly={line.is_manual_only ?? false}
                  />
                ) : null}
                <div className="flex-1 min-w-0 pr-4">
                  <h3 className="text-base font-semibold truncate">
                    {line.description}
                  </h3>
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

/**
 * Cart-row mode badge — matches the dimensions and treatment of the
 * EPCs / MANUAL pill on /inventory/catalog in WMS (h-[22px] w-[64px],
 * tracking-widest, color-mix tinted background, border on the same
 * hue). Sits at the leftmost column so every cart row aligns.
 *
 *   source="rfid"                     → green RFID
 *   source="manual" + manual_only=true  → green MANUAL  (expected)
 *   source="manual" + manual_only=false → red   MANUAL  (mismatch)
 *
 * The red case flags an RFID-mode catalog item that came in via manual
 * entry — the cashier should have scanned its tag. WMS sees both rows.
 */
function ModeBadge({
  source,
  isManualOnly,
}: {
  source: "manual" | "rfid";
  isManualOnly: boolean;
}) {
  const isRfid = source === "rfid";
  const isMismatch = source === "manual" && !isManualOnly;
  const label = isRfid ? "RFID" : "MANUAL";
  const title = isRfid
    ? "Added by RFID scan"
    : isManualOnly
      ? "Manual item (catalog flagged non-RFID)"
      : "RFID-mode item added manually — should have been scanned";
  // Tailwind doesn't have a color-mix helper; using arbitrary `bg-`
  // tints from the green-500 / red-500 swatches at 18% opacity which
  // gives the same visual weight as the WMS EPC pill.
  const colorClass = isMismatch
    ? "border-red-400/60 bg-red-100 text-red-700"
    : "border-emerald-500/50 bg-emerald-100 text-emerald-700";
  return (
    <span
      title={title}
      className={`shrink-0 mr-3 inline-flex h-[22px] w-[64px] items-center justify-center rounded border px-2 text-[0.6rem] font-medium leading-none tracking-widest ${colorClass}`}
    >
      {label}
    </span>
  );
}
