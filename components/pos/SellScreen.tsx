"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ItemSearch, type SearchResultItem } from "./ItemSearch";
import { CartPanel } from "./CartPanel";
import { TotalPanel } from "./TotalPanel";
import { RFIDScanModal, type RfidResolvedItem } from "./RFIDScanModal";
import { calculateTotals } from "@/lib/tax";
import type { CartLine } from "@/types/pos";

/**
 * Sell screen. Renders inside the back-office AdminShell — the layout
 * matches the carbon_sales_interface_active_cart_light reference:
 *
 *   [breadcrumb]
 *   [register header card]
 *   ┌──────────────── left ────────────────┐ ┌── right (420px) ──┐
 *   │ search + RFID                         │ │ Customer           │
 *   │ cart (item rows w/ qty stepper)       │ │ Subtotal/Disc/Tax  │
 *   │ Misc · Hold · Clear                   │ │ Total              │
 *   └───────────────────────────────────────┘ │ Apply discount     │
 *                                             │ Charge Card        │
 *                                             │ Take Cash          │
 *                                             │ Other              │
 *                                             └────────────────────┘
 */
export function SellScreen({
  taxRate,
  registerName,
  code,
}: {
  taxRate: number;
  registerName: string;
  /** Active location code (e.g. "003") — used to build navigation URLs. */
  code: string;
  /** Kept for backward-compat; the AdminShell now handles sign-out. */
  onSignOut?: () => void;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [showRfid, setShowRfid] = useState(false);
  const [showMisc, setShowMisc] = useState(false);
  const [discountFor, setDiscountFor] = useState<string | "sale" | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);

  const totals = useMemo(
    () => calculateTotals(lines, taxRate),
    [lines, taxRate],
  );
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);

  function addProduct(item: SearchResultItem) {
    const price = Number(item.retail_price ?? 0);
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.sku_id === item.id && l.line_type === "product" && !l.epc,
      );
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          cart_id: cryptoId(),
          sku_id: item.id,
          epc: null,
          description: [item.item_name, item.color, item.size]
            .filter(Boolean)
            .join(" · "),
          quantity: 1,
          unit_price: price,
          discount_amount: 0,
          tax_rate: taxRate,
          line_type: "product",
        },
      ];
    });
  }

  function addRfidItems(items: RfidResolvedItem[]) {
    setLines((prev) => [
      ...prev,
      ...items.map<CartLine>((it) => ({
        cart_id: cryptoId(),
        sku_id: it.sku_id,
        epc: it.epc,
        description: [it.item_name, it.color, it.size]
          .filter(Boolean)
          .join(" · "),
        quantity: 1,
        unit_price: Number(it.retail_price ?? 0),
        discount_amount: 0,
        tax_rate: taxRate,
        line_type: "product",
      })),
    ]);
  }

  function addMiscCharge(description: string, amount: number) {
    setLines((prev) => [
      ...prev,
      {
        cart_id: cryptoId(),
        sku_id: null,
        epc: null,
        description,
        quantity: 1,
        unit_price: amount,
        discount_amount: 0,
        tax_rate: taxRate,
        line_type: "misc",
      },
    ]);
  }

  function changeQty(cartId: string, next: number) {
    setLines((prev) =>
      prev.map((l) => (l.cart_id === cartId ? { ...l, quantity: next } : l)),
    );
  }

  function removeLine(cartId: string) {
    setLines((prev) => prev.filter((l) => l.cart_id !== cartId));
  }

  function applyLineDiscount(cartId: string, value: number, isPercent: boolean) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.cart_id !== cartId) return l;
        const subtotal = l.unit_price * l.quantity;
        const discount = isPercent
          ? Math.min(subtotal, subtotal * (value / 100))
          : Math.min(subtotal, value);
        return { ...l, discount_amount: Math.max(0, discount) };
      }),
    );
  }

  function applySaleDiscount(value: number, isPercent: boolean) {
    setLines((prev) => {
      const subtotal = prev.reduce(
        (s, l) => s + l.unit_price * l.quantity,
        0,
      );
      if (subtotal <= 0) return prev;
      const total = isPercent
        ? subtotal * (value / 100)
        : Math.min(subtotal, value);
      return prev.map((l) => {
        const lineSubtotal = l.unit_price * l.quantity;
        const share = subtotal > 0 ? lineSubtotal / subtotal : 0;
        return { ...l, discount_amount: Math.max(0, total * share) };
      });
    });
  }

  function startCheckout(method: "card" | "cash" | "other") {
    if (lines.length === 0) return;
    const cart = encodeURIComponent(
      JSON.stringify({ lines, totals, customerName, taxRate }),
    );
    router.push(`/sales/${code}/payment?method=${method}&cart=${cart}`);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col space-y-6">
      {/* Breadcrumb */}
      <div className="text-xs text-[var(--carbon-muted)] font-bold uppercase tracking-wider">
        /POS — REGISTER SCREEN, {itemCount} ITEM{itemCount === 1 ? "" : "S"} IN CART
      </div>

      {/* Register header card */}
      <div className="carbon-card p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{registerName}</h1>
          <p className="text-sm text-[var(--carbon-muted)] mt-1">
            Tax rate {(taxRate * 100).toFixed(2)}%
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/30">
            Drawer open
          </span>
          <button
            onClick={() => router.push(`/sales/${code}/register`)}
            className="carbon-btn-secondary tap px-5 font-semibold"
          >
            Register
          </button>
        </div>
      </div>

      {/* Main POS area */}
      <div className="flex flex-1 gap-6 min-h-0 flex-col xl:flex-row">
        {/* Left column — search + cart + bottom actions */}
        <div className="flex-1 flex flex-col space-y-4 min-w-0">
          <div className="flex gap-4">
            <div className="flex-1">
              <ItemSearch onPick={addProduct} />
            </div>
            <button
              onClick={() => setShowRfid(true)}
              className="carbon-btn-secondary tap-lg px-6 font-semibold whitespace-nowrap"
            >
              Scan RFID
            </button>
          </div>

          <CartPanel
            lines={lines}
            onChangeQty={changeQty}
            onRemove={removeLine}
            onEditDiscount={(id) => setDiscountFor(id)}
          />

          <div className="flex gap-4 pt-2">
            <button
              onClick={() => setShowMisc(true)}
              className="flex-1 carbon-btn-secondary tap font-semibold"
            >
              Misc Charge
            </button>
            <button
              disabled={lines.length === 0}
              className="flex-1 carbon-btn-secondary tap font-semibold disabled:opacity-50"
              title="Phase 2"
            >
              Hold Sale
            </button>
            <button
              onClick={() => setLines([])}
              disabled={lines.length === 0}
              className="flex-1 tap font-semibold border border-red-200 text-carbon-danger hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Clear All
            </button>
          </div>
        </div>

        {/* Right column — checkout */}
        <div className="xl:w-[420px] flex-shrink-0">
          <TotalPanel
            totals={totals}
            customerName={customerName}
            onAddCustomer={() => {
              const name = window.prompt(
                "Customer name (optional, helps for receipts):",
              );
              if (name && name.trim()) setCustomerName(name.trim());
            }}
            onApplyDiscount={() => setDiscountFor("sale")}
            onChargeCard={() => startCheckout("card")}
            onTakeCash={() => startCheckout("cash")}
            onOtherPayment={() => startCheckout("other")}
            disabled={lines.length === 0}
          />
        </div>
      </div>

      <RFIDScanModal
        open={showRfid}
        onClose={() => setShowRfid(false)}
        onAdd={addRfidItems}
      />
      {showMisc && (
        <MiscChargeModal
          onCancel={() => setShowMisc(false)}
          onAdd={(desc, amt) => {
            addMiscCharge(desc, amt);
            setShowMisc(false);
          }}
        />
      )}
      {discountFor && (
        <DiscountModal
          target={discountFor}
          onCancel={() => setDiscountFor(null)}
          onApply={(value, isPercent) => {
            if (discountFor === "sale") applySaleDiscount(value, isPercent);
            else applyLineDiscount(discountFor, value, isPercent);
            setDiscountFor(null);
          }}
        />
      )}
    </div>
  );
}

function MiscChargeModal({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (description: string, amount: number) => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <BasicModal title="Misc Charge" onCancel={onCancel}>
      <p className="text-[var(--color-pos-muted)]">
        For items not in the catalog. Don&apos;t use this if a barcode exists.
      </p>
      <label className="block mt-3 text-sm font-medium">Description</label>
      <input
        autoFocus
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="tap w-full border border-[var(--color-pos-border)] px-3 mt-1"
      />
      <label className="block mt-3 text-sm font-medium">Amount</label>
      <input
        type="number"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="tap-lg w-full border border-[var(--color-pos-border)] px-3 text-2xl font-semibold mt-1"
      />
      <div className="mt-5 flex gap-2">
        <button
          onClick={onCancel}
          className="tap border border-[var(--color-pos-border)] flex-1 font-medium"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const n = Number(amount);
            if (!description.trim() || !Number.isFinite(n) || n <= 0) return;
            onAdd(description.trim(), n);
          }}
          className="tap carbon-btn-primary flex-1 font-semibold"
        >
          Add
        </button>
      </div>
    </BasicModal>
  );
}

function DiscountModal({
  target,
  onCancel,
  onApply,
}: {
  target: string | "sale";
  onCancel: () => void;
  onApply: (value: number, isPercent: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"percent" | "fixed">("percent");
  return (
    <BasicModal
      title={target === "sale" ? "Discount the whole sale" : "Discount line"}
      onCancel={onCancel}
    >
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          onClick={() => setMode("percent")}
          className={`tap border ${
            mode === "percent"
              ? "carbon-btn-primary"
              : "border-[var(--color-pos-border)]"
          }`}
        >
          % Off
        </button>
        <button
          onClick={() => setMode("fixed")}
          className={`tap border ${
            mode === "fixed"
              ? "carbon-btn-primary"
              : "border-[var(--color-pos-border)]"
          }`}
        >
          $ Off
        </button>
      </div>
      <input
        autoFocus
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={mode === "percent" ? "10" : "5.00"}
        className="tap-lg w-full border border-[var(--color-pos-border)] px-3 text-3xl font-semibold mt-3"
      />
      {mode === "percent" && Number(value) > 20 && (
        <p className="text-xs text-amber-700 mt-2">
          Discounts over 20% need a manager PIN. (Phase 2 enforces this.)
        </p>
      )}
      <div className="mt-5 flex gap-2">
        <button
          onClick={onCancel}
          className="tap border border-[var(--color-pos-border)] flex-1 font-medium"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const n = Number(value);
            if (!Number.isFinite(n) || n <= 0) return;
            onApply(n, mode === "percent");
          }}
          className="tap carbon-btn-primary flex-1 font-semibold"
        >
          Apply
        </button>
      </div>
    </BasicModal>
  );
}

function BasicModal({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-md p-6 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            onClick={onCancel}
            className="text-[var(--color-pos-muted)] text-xl leading-none px-2"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Stable id for cart rows. */
function cryptoId(): string {
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis.crypto as Crypto | undefined)?.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
