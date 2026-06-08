"use client";

import { useState } from "react";
import { Trash2, Minus, Plus, Barcode, Radio, ChevronDown } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import type { CartLine, AttributionEmployee } from "@/types/pos";
import { ProductImagePreview } from "./ProductImagePreview";

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
  saleNumberPreview,
  employees,
  saleAttributedEmployeeId,
  onChangeSaleEmployee,
  onChangeLineEmployee,
}: {
  lines: CartLine[];
  onChangeQty: (cartId: string, next: number) => void;
  onRemove: (cartId: string) => void;
  onEditDiscount: (cartId: string) => void;
  /** 6-char "LL+SSS+check" preview of the sale # the next completed
   *  sale will receive (e.g. "010012"). Rendered next to the "Cart"
   *  label in the header — purely informational. */
  saleNumberPreview?: string | null;
  /** Active sales associates eligible to receive credit for this sale.
   *  Powers both the cart-header dropdown and the per-row dropdowns. */
  employees: AttributionEmployee[];
  /** pos_employees.id currently set as the sale-wide attribution. The
   *  cart-header dropdown reflects + edits this value; changing it
   *  bulk-rewrites every line's attribution via onChangeSaleEmployee. */
  saleAttributedEmployeeId: number;
  /** Cart-header dropdown handler: caller is expected to overwrite every
   *  line's attributed_employee_id to the new value (the header wins). */
  onChangeSaleEmployee: (employeeId: number) => void;
  /** Per-row dropdown handler. */
  onChangeLineEmployee: (cartId: string, employeeId: number) => void;
}) {
  // Which row is currently expanded — at most one at a time. Tapping a
  // row toggles; tapping interactive children (qty, price, trash, employee)
  // is suppressed via stopPropagation so they don't accidentally toggle.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Cart line whose picture is open in the full preview (same popup as
  // product management). Null = closed.
  const [previewLine, setPreviewLine] = useState<CartLine | null>(null);
  const headerLabel = saleNumberPreview
    ? `Cart \\ Sale ${saleNumberPreview}`
    : "Cart";
  if (lines.length === 0) {
    return (
      <div className="carbon-card flex-1 flex flex-col min-h-[200px]">
        <CartHeader
          label={headerLabel}
          employees={employees}
          value={saleAttributedEmployeeId}
          onChange={onChangeSaleEmployee}
        />
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
      <CartHeader
        label={headerLabel}
        employees={employees}
        value={saleAttributedEmployeeId}
        onChange={onChangeSaleEmployee}
      />
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
                className="border-b border-[var(--carbon-border-soft)] last:border-b-0"
              >
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  setExpandedId((cur) => (cur === line.cart_id ? null : line.cart_id))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedId((cur) => (cur === line.cart_id ? null : line.cart_id));
                  }
                }}
                className="flex items-center justify-between px-3 sm:px-4 py-2 gap-2 sm:gap-0 hover:bg-[var(--carbon-surface-soft)] transition-colors cursor-pointer select-none"
              >
                {/* Thumbnail — hidden on mobile to give the description room.
                    Row vertical padding stays py-2 so each row aligns. Shows
                    the variant's color picture (Shopify CDN URL) when synced,
                    else the checkroom placeholder. */}
                {line.line_type === "product" ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewLine(line);
                    }}
                    title="View product image"
                    className="w-16 aspect-[3/4] shrink-0 mr-4 hidden md:flex items-center justify-center bg-[var(--carbon-surface-soft)] border border-[var(--carbon-border-soft)] overflow-hidden hover:border-carbon-blue transition-colors"
                  >
                    {line.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={line.image_url}
                        alt={line.description}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="material-symbols-outlined text-[40px] text-[var(--carbon-muted)]">
                        checkroom
                      </span>
                    )}
                  </button>
                ) : null}
                {/* Mode badge — sits to the LEFT of the description so
                    every row aligns to a fixed-width 64×22 pill.
                      • RFID source                                → green radio
                      • Manual src + catalog is_manual_only=true   → green barcode
                      • Manual src + catalog is_manual_only=false  → red radio
                        (RFID-mode item entered via 2D scan or
                        keyboard — antenna should have caught it)
                    Lucide icons match the Type column in /inventory. */}
                {line.line_type === "product" ? (
                  <ModeBadge
                    source={line.source ?? "manual"}
                    isManualOnly={line.is_manual_only ?? false}
                  />
                ) : null}
                <div className="flex-1 min-w-0 pr-2 sm:pr-4">
                  <h3 className="text-sm sm:text-base font-semibold truncate">
                    {line.description}
                  </h3>
                  {subtitle && (
                    <p className="text-xs sm:text-sm text-carbon-text font-medium mt-0.5 sm:mt-1 truncate">
                      {subtitle}
                    </p>
                  )}
                </div>
                {/* Per-row employee attribution — sits in its own middle
                    column between the description and the qty/price block.
                    Always visible (works on touch and mouse). Pulses to
                    a soft Carbon-Blue when the row's pick differs from the
                    sale-wide value so re-assigned lines are easy to spot. */}
                <div
                  className="shrink-0 mr-4 hidden sm:block"
                  onClick={(e) => e.stopPropagation()}
                >
                  <EmployeeSelect
                    employees={employees}
                    value={line.attributed_employee_id ?? saleAttributedEmployeeId}
                    differsFromSale={
                      (line.attributed_employee_id ?? saleAttributedEmployeeId) !==
                      saleAttributedEmployeeId
                    }
                    onChange={(id) => onChangeLineEmployee(line.cart_id, id)}
                    size="sm"
                  />
                </div>
                <div
                  className="flex items-center gap-2 sm:gap-4 lg:gap-6 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {line.line_type === "product" ? (
                    line.source === "rfid" ? (
                      // RFID-stacked rows: qty equals the EPC count and
                      // can't be edited with +/-. Each tag is a unique
                      // physical item. Removing the row drops all EPCs
                      // in this stack.
                      <span
                        className="inline-flex items-center justify-center min-w-[2.25rem] sm:min-w-[3rem] px-2 sm:px-3 py-1 border border-[var(--carbon-border)] bg-carbon-surface-soft text-carbon-text font-semibold tabular-nums text-sm"
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
                          className="px-2 sm:px-3 py-1 text-[var(--carbon-muted)] hover:bg-[var(--carbon-surface-soft)] transition-colors"
                        >
                          <Minus size={16} />
                        </button>
                        <span className="px-2 sm:px-3 py-1 font-medium border-x border-[var(--carbon-border)] min-w-[2rem] sm:min-w-[2.5rem] text-center tabular-nums text-sm">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => onChangeQty(line.cart_id, line.quantity + 1)}
                          aria-label="Increase quantity"
                          className="px-2 sm:px-3 py-1 text-[var(--carbon-muted)] hover:bg-[var(--carbon-surface-soft)] transition-colors"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    )
                  ) : (
                    <span className="text-[10px] sm:text-xs text-[var(--carbon-muted)] uppercase tracking-wider font-bold">
                      Misc
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onEditDiscount(line.cart_id)}
                    className="text-right w-16 sm:w-24 text-sm sm:text-base font-semibold tabular-nums hover:text-carbon-blue"
                    title="Click to edit price or apply a discount"
                  >
                    {formatMoney(lineTotal)}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(line.cart_id)}
                    aria-label="Remove item"
                    className="text-[var(--carbon-muted)] hover:text-carbon-danger transition-colors p-1"
                  >
                    <Trash2 size={18} />
                  </button>
                  {/* Chevron — purely a visual affordance showing the
                      row can be expanded. The whole row is the toggle. */}
                  <ChevronDown
                    size={16}
                    aria-hidden
                    className={`text-carbon-text-muted shrink-0 transition-transform ${
                      expandedId === line.cart_id ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </div>
              {expandedId === line.cart_id ? (
                <ExpandedDetails
                  line={line}
                  employees={employees}
                  saleAttributedEmployeeId={saleAttributedEmployeeId}
                  onChangeLineEmployee={onChangeLineEmployee}
                  onPreview={() => setPreviewLine(line)}
                />
              ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {previewLine ? (
        <ProductImagePreview
          imageUrl={previewLine.image_url ?? null}
          title={previewLine.description}
          subtitle={[
            previewLine.sku,
            previewLine.upc ? `UPC ${previewLine.upc}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          onClose={() => setPreviewLine(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Cart-row mode badge — icon-only pill at the leftmost column so every
 * cart row aligns. Lucide icons (barcode / radio), matching the same
 * icons used in /inventory product management.
 *
 *   source="rfid"                       → green radio   (Scanned tag)
 *   source="manual" + manual_only=true  → green barcode (Real manual item)
 *   source="manual" + manual_only=false → red   radio   (RFID-mode item
 *                                                       added by 2D scan
 *                                                       or manual entry —
 *                                                       should have been
 *                                                       picked up by the
 *                                                       RFID antenna)
 *
 * Default everywhere is green ("this item is fine"). Red appears only on
 * the radio icon and only when an RFID-tagged item entered the cart via
 * a non-RFID path — flags a missed antenna read for the cashier.
 */
/**
 * Cart header row — left side is the "CART \ SALE 010012" label, right
 * side is the sale-wide Employee dropdown. Changing the dropdown bulk-
 * rewrites every cart row's attribution (header wins, by design).
 */
/**
 * Drops below the row when expanded — shows everything the compact row
 * truncates: full description, SKU, UPC, source/mode, EPC list (RFID
 * rows), attributed employee, unit price + discount math, and the
 * inline employee dropdown so re-assignment works on mobile (where the
 * inline-row dropdown is hidden for space). Tapping interactive
 * elements inside is stop-propagated by the wrapper so they don't
 * collapse the row.
 */
function ExpandedDetails({
  line,
  employees,
  saleAttributedEmployeeId,
  onChangeLineEmployee,
  onPreview,
}: {
  line: CartLine;
  employees: AttributionEmployee[];
  saleAttributedEmployeeId: number;
  onChangeLineEmployee: (cartId: string, employeeId: number) => void;
  onPreview?: () => void;
}) {
  const lineSubtotal = line.unit_price * line.quantity;
  const lineTotal = lineSubtotal - line.discount_amount;
  const epcs = line.epcs ?? (line.epc ? [line.epc] : []);
  type DetailRow = { k: string; v: React.ReactNode };
  const rows: DetailRow[] = ([
    { k: "Description", v: line.description },
    line.sku ? { k: "SKU", v: line.sku } : null,
    line.upc ? { k: "UPC", v: line.upc } : null,
    line.line_type === "product"
      ? {
          k: "Source",
          v: line.source === "rfid" ? "RFID scan" : "Manual entry",
        }
      : null,
    line.line_type === "product" && line.is_manual_only != null
      ? {
          k: "Catalog mode",
          v: line.is_manual_only ? "Manual-only" : "RFID-enabled",
        }
      : null,
    { k: "Unit price", v: formatMoney(line.unit_price) },
    { k: "Quantity", v: String(line.quantity) },
    line.discount_amount > 0
      ? { k: "Discount", v: `−${formatMoney(line.discount_amount)}` }
      : null,
    { k: "Line total", v: formatMoney(lineTotal) },
  ] as Array<DetailRow | null>).filter((r): r is DetailRow => r !== null);
  return (
    <div
      className="px-3 sm:px-4 pb-3 pt-1 bg-[var(--carbon-surface-soft)] border-t border-[var(--carbon-border-soft)] flex items-start gap-4"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Picture on the LEFT, sized to the detail block; item info to its
          right (matches the product-management / reference layout). */}
      {line.line_type === "product" ? (
        <button
          type="button"
          onClick={onPreview}
          title="View product image"
          className="w-40 aspect-[3/4] shrink-0 hidden sm:flex items-center justify-center bg-white border border-[var(--carbon-border-soft)] overflow-hidden hover:border-carbon-blue transition-colors"
        >
          {line.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={line.image_url}
              alt={line.description}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="material-symbols-outlined text-[48px] text-[var(--carbon-muted)]">
              checkroom
            </span>
          )}
        </button>
      ) : null}
      <dl className="flex-1 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs sm:text-sm self-start">
        {rows.map((r) => (
          <div key={r.k} className="contents">
            <dt className="text-carbon-text-muted">{r.k}</dt>
            <dd className="text-carbon-text font-medium break-words">{r.v}</dd>
          </div>
        ))}
        {epcs.length > 0 ? (
          <div className="contents">
            <dt className="text-carbon-text-muted">
              EPC{epcs.length === 1 ? "" : `s (${epcs.length})`}
            </dt>
            <dd className="text-carbon-text font-mono text-[11px] break-all">
              {epcs.join(", ")}
            </dd>
          </div>
        ) : null}
        <div className="contents">
          <dt className="text-carbon-text-muted">Employee</dt>
          <dd>
            <EmployeeSelect
              employees={employees}
              value={line.attributed_employee_id ?? saleAttributedEmployeeId}
              differsFromSale={
                (line.attributed_employee_id ?? saleAttributedEmployeeId) !==
                saleAttributedEmployeeId
              }
              onChange={(id) => onChangeLineEmployee(line.cart_id, id)}
              size="sm"
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function CartHeader({
  label,
  employees,
  value,
  onChange,
}: {
  label: string;
  employees: AttributionEmployee[];
  value: number;
  onChange: (employeeId: number) => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-[var(--carbon-border-soft)] flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
        {label}
      </span>
      <EmployeeSelect
        employees={employees}
        value={value}
        onChange={onChange}
        size="md"
      />
    </div>
  );
}

/**
 * Compact "Employee:" dropdown. Native <select> — auto-handles touch,
 * keyboard, and screen readers without us writing our own popover. The
 * size variant controls vertical padding (sm for cart rows, md for the
 * header) and we color-shift the chip when a row's pick differs from the
 * sale-wide value so the cashier can spot re-assigned lines.
 */
function EmployeeSelect({
  employees,
  value,
  onChange,
  size,
  differsFromSale,
}: {
  employees: AttributionEmployee[];
  value: number;
  onChange: (employeeId: number) => void;
  size: "sm" | "md";
  differsFromSale?: boolean;
}) {
  const padCls = size === "sm" ? "py-0.5 pl-2 pr-7 text-xs" : "py-1 pl-2.5 pr-8 text-sm";
  // Soft Carbon-Blue tint when this row's employee differs from the
  // sale-wide default — flags an individually re-assigned line.
  const colorCls = differsFromSale
    ? "border-carbon-blue/50 bg-carbon-blue-soft text-carbon-blue"
    : "border-carbon-border bg-white text-carbon-text";
  // If the current value isn't in the list yet (employees still loading)
  // we keep the value attribute set so React doesn't fire an unexpected
  // change event — the select just shows blank until the list arrives.
  return (
    <label className="relative inline-flex items-center gap-1.5 shrink-0">
      <span
        className={`material-symbols-outlined ${size === "sm" ? "text-[14px]" : "text-[16px]"} text-carbon-text-muted`}
        aria-hidden
      >
        badge
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`appearance-none rounded border ${colorCls} ${padCls} font-medium focus:outline-none focus:border-carbon-blue cursor-pointer max-w-[180px] truncate`}
        title="Employee credited for this line / sale"
      >
        {/* Render the current value even if it's not yet in the loaded
            list — keeps the select stable across async loads. */}
        {employees.find((e) => e.id === value) ? null : (
          <option value={value}>—</option>
        )}
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {emp.display_name || emp.email}
          </option>
        ))}
      </select>
      <span
        className={`material-symbols-outlined absolute right-1 ${size === "sm" ? "text-[14px]" : "text-[16px]"} text-carbon-text-muted pointer-events-none`}
        aria-hidden
      >
        expand_more
      </span>
    </label>
  );
}

function ModeBadge({
  source,
  isManualOnly,
}: {
  source: "manual" | "rfid";
  isManualOnly: boolean;
}) {
  const isRfid = source === "rfid";
  const isMismatch = source === "manual" && !isManualOnly;
  // Icon: radio for anything that has an RFID chip (scanned OR a manually-
  // entered RFID-mode item); barcode for genuine manual items.
  const IconCmp = isRfid || isMismatch ? Radio : Barcode;
  const title = isRfid
    ? "Added by RFID scan"
    : isManualOnly
      ? "Manual item (catalog flagged non-RFID)"
      : "RFID-mode item added manually — should have been scanned";
  const colorClass = isMismatch
    ? "border-red-400/60 bg-red-100 text-red-700"
    : "border-green-500/45 bg-green-100 text-green-700";
  return (
    <span
      title={title}
      className={`tap shrink-0 mr-2 sm:mr-3 inline-flex w-[44px] sm:w-[64px] items-center justify-center border px-2 leading-none ${colorClass}`}
    >
      <IconCmp className="h-7 w-7" aria-hidden />
    </span>
  );
}
