"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";
import type { CartTotals } from "@/types/pos";

export type PickedCustomer = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
};

type SearchResult = {
  id: number;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
};

/**
 * Right-side checkout panel. The customer slot is now an inline search
 * input + a small blue square "+" button: typing fires a debounced search
 * against /api/pos/customers (matches name / email / phone), the dropdown
 * shows hits, picking one attaches that customer to the sale. The "+"
 * button creates a brand-new customer via the back-office form, which
 * round-trips back to /sales/{code}/new with ?customer_id&customer_name
 * appended.
 */
export function TotalPanel({
  totals,
  customer,
  loyaltyBalance,
  onPickCustomer,
  onClearCustomer,
  onNewCustomer,
  onRedeemPoints,
  onApplyDiscount,
  onChargeCard,
  onTakeCash,
  onOtherPayment,
  disabled,
}: {
  totals: CartTotals;
  customer: PickedCustomer | null;
  /** Loyalty points balance for the attached customer (null = unknown / loading). */
  loyaltyBalance: number | null;
  onPickCustomer: (c: PickedCustomer) => void;
  onClearCustomer: () => void;
  onNewCustomer: () => void;
  onRedeemPoints: () => void;
  onApplyDiscount: () => void;
  onChargeCard: () => void;
  onTakeCash: () => void;
  onOtherPayment: () => void;
  disabled: boolean;
}) {
  return (
    <aside className="carbon-card flex flex-col">
      {/* Customer */}
      <div className="p-6 border-b border-[var(--carbon-border-soft)]">
        <div className="text-xs text-carbon-text-muted mb-2 uppercase tracking-wider font-bold">
          Customer
        </div>
        {customer ? (
          <>
            <CustomerCard customer={customer} onClear={onClearCustomer} />
            {/* Loyalty pill — appears once balance loads. */}
            {loyaltyBalance !== null ? (
              <div className="mt-3 flex items-center justify-between p-2 px-3 bg-[var(--carbon-blue-soft)] border border-carbon-blue/30">
                <span className="text-sm flex items-center gap-2">
                  <span className="material-symbols-outlined text-carbon-blue text-base" aria-hidden>stars</span>
                  <span className="font-bold text-carbon-blue tabular-nums">
                    {loyaltyBalance.toLocaleString()} pts
                  </span>
                </span>
                <button
                  type="button"
                  onClick={onRedeemPoints}
                  disabled={loyaltyBalance < 100 || disabled}
                  className="carbon-btn-secondary text-xs font-bold px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Redeem
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <CustomerSearchRow
            onPick={onPickCustomer}
            onNewCustomer={onNewCustomer}
          />
        )}
      </div>

      {/* Totals */}
      <div className="p-6 space-y-3 flex-1">
        <div className="flex justify-between text-[var(--carbon-muted)]">
          <span>Subtotal</span>
          <span className="font-medium text-carbon-text tabular-nums">
            {formatMoney(totals.subtotal)}
          </span>
        </div>
        {totals.discount > 0 ? (
          <div className="flex justify-between text-emerald-700">
            <span>Discount</span>
            <span className="font-medium tabular-nums">
              −{formatMoney(totals.discount)}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between text-[var(--carbon-muted)] pb-4 border-b border-[var(--carbon-border-soft)]">
          <span>Tax</span>
          <span className="font-medium text-carbon-text tabular-nums">
            {formatMoney(totals.tax)}
          </span>
        </div>
        <div className="flex justify-between items-end pt-2">
          <span className="text-xl font-bold">Total</span>
          <span className="total-display text-4xl">
            {formatMoney(totals.total)}
          </span>
        </div>
      </div>

      {/* Payment buttons */}
      <div className="p-6 space-y-4 bg-[var(--carbon-surface-soft)] border-t border-[var(--carbon-border-soft)]">
        <button
          type="button"
          onClick={onApplyDiscount}
          disabled={disabled}
          className="w-full carbon-btn-secondary tap font-semibold disabled:opacity-50"
        >
          Apply Discount to Sale
        </button>
        <button
          type="button"
          onClick={onChargeCard}
          disabled={disabled}
          className="w-full carbon-btn-primary tap-lg text-lg font-bold disabled:opacity-50"
        >
          Charge Card
        </button>
        <button
          type="button"
          onClick={onTakeCash}
          disabled={disabled}
          className="w-full carbon-btn-primary tap-lg text-lg font-bold disabled:opacity-50"
        >
          Take Cash
        </button>
        <button
          type="button"
          onClick={onOtherPayment}
          disabled={disabled}
          className="w-full carbon-btn-secondary tap font-semibold disabled:opacity-50"
        >
          Other (Store Credit, Account, Gift Card)
        </button>
      </div>
    </aside>
  );
}

function CustomerCard({
  customer,
  onClear,
}: {
  customer: PickedCustomer;
  onClear: () => void;
}) {
  const sub = [customer.email, customer.phone].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-semibold text-lg truncate text-carbon-text">
          {customer.name}
        </div>
        {sub ? (
          <div className="text-xs text-carbon-text-muted truncate mt-0.5">
            {sub}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClear}
        title="Clear customer"
        className="w-8 h-8 inline-flex items-center justify-center text-carbon-text-muted hover:text-carbon-danger hover:bg-[var(--carbon-surface-soft)] shrink-0"
      >
        <span className="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
  );
}

function CustomerSearchRow({
  onPick,
  onNewCustomer,
}: {
  onPick: (c: PickedCustomer) => void;
  onNewCustomer: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Debounced search.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const term = q.trim();
    if (term.length === 0) {
      setResults([]);
      return;
    }
    setBusy(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/pos/customers?q=${encodeURIComponent(term)}`,
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { customers: SearchResult[] };
        setResults(data.customers ?? []);
        setOpen(true);
      } finally {
        setBusy(false);
      }
    }, 200);
  }, [q]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(r: SearchResult) {
    const fullName = [r.first_name, r.last_name].filter(Boolean).join(" ");
    onPick({
      id: r.id,
      name: fullName || r.email || "Customer",
      email: r.email,
      phone: r.mobile_phone || r.phone,
    });
    setQ("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-stretch gap-2">
        {/* Search input — flex-1, leading magnifier */}
        <div className="carbon-input flex-1 flex items-center gap-2 px-3 py-2">
          <span
            className="material-symbols-outlined text-carbon-text-muted text-xl shrink-0"
            aria-hidden
          >
            search
          </span>
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => results.length && setOpen(true)}
            placeholder="Search name, email, phone…"
            className="flex-1 bg-transparent border-0 outline-none p-0 text-sm font-medium text-carbon-text placeholder:text-carbon-text-muted/70"
          />
        </div>
        {/* Compact + button — same Carbon Blue, icon only, square */}
        <button
          type="button"
          onClick={onNewCustomer}
          title="New customer"
          aria-label="New customer"
          className="carbon-btn-primary inline-flex items-center justify-center w-10 shrink-0"
        >
          <span className="material-symbols-outlined text-xl">add</span>
        </button>
      </div>

      {/* Results dropdown */}
      {open && q.trim() ? (
        <div className="absolute left-0 right-0 mt-1 carbon-card shadow-lg z-30 max-h-72 overflow-auto">
          {busy && results.length === 0 ? (
            <p className="p-4 text-sm text-carbon-text-muted">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-4 text-sm text-carbon-text-muted">
              No matches. Try fewer characters or tap{" "}
              <span className="font-bold text-carbon-blue">+</span> to create.
            </p>
          ) : (
            <ul className="divide-y divide-carbon-border-soft">
              {results.map((r) => {
                const fullName =
                  [r.first_name, r.last_name].filter(Boolean).join(" ") ||
                  "(no name)";
                const phone = r.mobile_phone || r.phone || "";
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => pick(r)}
                      className="w-full text-left px-4 py-3 hover:bg-[var(--carbon-surface-soft)] transition-colors"
                    >
                      <div className="font-semibold text-carbon-text">
                        {fullName}
                      </div>
                      <div className="text-xs text-carbon-text-muted mt-0.5 flex gap-3 flex-wrap">
                        {r.email ? <span>{r.email}</span> : null}
                        {phone ? <span>{phone}</span> : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
