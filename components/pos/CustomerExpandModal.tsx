"use client";

import { useEffect, useState, useRef } from "react";
import { formatMoney } from "@/lib/utils";

/**
 * Full-table customer search in a modal popup. Mirrors the columns +
 * row layout of the /customers/[code] admin page (Name / Email / Phone
 * / Type / Sales / Store credit) so the cashier can browse a wider
 * list without leaving the sell screen. Picking a row calls back to
 * the parent's onPick (same payload shape the inline search uses) and
 * closes the modal.
 */

type CustomerRow = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone?: string | null;
  customer_type: string;
  store_credit_balance: string | number;
  sales_count: number;
};

export type CustomerExpandPicked = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
};

export function CustomerExpandModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (c: CustomerExpandPicked) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setBusy(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const url = q.trim()
          ? `/api/pos/customers?q=${encodeURIComponent(q.trim())}&limit=200`
          : `/api/pos/customers?limit=200`;
        const res = await fetch(url);
        if (!res.ok) {
          setRows([]);
          return;
        }
        const data = await res.json();
        setRows((data.customers as CustomerRow[]) ?? []);
      } finally {
        setBusy(false);
      }
    }, 200);
  }, [q, open]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Expand customer search"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="carbon-card flex flex-col w-full max-w-5xl max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-carbon-border-soft">
          <h2 className="font-semibold text-lg">Search customers</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 inline-flex items-center justify-center text-carbon-text-muted hover:text-carbon-text hover:bg-carbon-surface-soft"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-carbon-border-soft">
          <div className="carbon-input tap flex items-center gap-2 px-3">
            <span
              className="material-symbols-outlined text-carbon-text-muted text-xl shrink-0"
              aria-hidden
            >
              search
            </span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, email, phone…"
              autoFocus
              className="flex-1 bg-transparent border-0 outline-none p-0 text-sm font-medium text-carbon-text placeholder:text-carbon-text-muted/70"
            />
            {busy && (
              <span className="text-xs text-carbon-text-muted">Searching…</span>
            )}
          </div>
        </div>

        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-carbon-surface-soft sticky top-0">
              <tr className="text-left">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Sales</th>
                <th className="px-3 py-2 text-right">Store credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !busy ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-carbon-text-muted"
                  >
                    {q.trim()
                      ? "No matches. Try fewer characters or use the + button to create."
                      : "Start typing to search, or browse the list."}
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const fullName =
                    [c.first_name, c.last_name].filter(Boolean).join(" ") ||
                    c.email ||
                    "Customer";
                  return (
                    <tr
                      key={c.id}
                      className="border-t border-carbon-border-soft hover:bg-carbon-surface-soft cursor-pointer"
                      onClick={() => {
                        onPick({
                          id: c.id,
                          name: fullName,
                          email: c.email,
                          phone: c.mobile_phone || c.phone,
                        });
                        onClose();
                      }}
                    >
                      <td className="px-3 py-2 font-medium">{fullName}</td>
                      <td className="px-3 py-2 truncate max-w-[14rem]">
                        {c.email ?? "—"}
                      </td>
                      <td className="px-3 py-2">{c.phone ?? "—"}</td>
                      <td className="px-3 py-2">{c.customer_type}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.sales_count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(c.store_credit_balance)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
