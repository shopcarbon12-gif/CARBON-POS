"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/utils";

type Found = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  store_credit_balance: string | null;
};

export type SaleCustomer = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  store_credit: number;
  orders: number;
  spent: number;
} | null;

/**
 * Customer box on the order screen: shows the attached customer (with a
 * link to their profile) or lets a manager attach / change / remove one.
 */
export function SaleCustomerCard({
  code,
  saleId,
  customer,
  locked,
}: {
  code: string;
  saleId: number;
  customer: SaleCustomer;
  /** Store credit was used on this sale → customer can't be changed. */
  locked: boolean;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!picking) return;
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/pos/customers?q=${encodeURIComponent(term)}`).catch(() => null);
      if (r?.ok) setResults(((await r.json()) as { customers: Found[] }).customers.slice(0, 8));
    }, 250);
    return () => clearTimeout(t);
  }, [q, picking]);

  async function save(customerId: number | null) {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/pos/sales/${saleId}/customer`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_id: customerId }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      const d = (await r?.json().catch(() => ({}))) as { message?: string } | undefined;
      setError(d?.message ?? "Couldn't update the customer.");
      return;
    }
    setPicking(false);
    setQ("");
    router.refresh();
  }

  return (
    <div className="bg-white border border-[var(--color-pos-border)] p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Customer</h2>
        {!locked && !picking && (
          <button onClick={() => setPicking(true)} className="text-sm font-semibold text-carbon-blue hover:underline">
            {customer ? "Change" : "+ Add customer"}
          </button>
        )}
      </div>

      {customer ? (
        <div className="text-sm">
          <Link href={`/customers/${code}/${customer.id}`} className="font-semibold text-base hover:underline">
            {customer.name || "Unnamed customer"}
          </Link>
          {customer.email && <p className="text-carbon-text-muted">{customer.email}</p>}
          {customer.phone && <p className="text-carbon-text-muted">{customer.phone}</p>}
          <dl className="grid grid-cols-3 gap-2 mt-3">
            <Stat k="Orders" v={String(customer.orders)} />
            <Stat k="Spent" v={formatMoney(customer.spent)} />
            <Stat k="Store credit" v={formatMoney(customer.store_credit)} />
          </dl>
          <div className="flex gap-3 mt-3">
            <Link href={`/customers/${code}/${customer.id}`} className="text-sm font-semibold text-carbon-blue hover:underline">
              View profile →
            </Link>
            {!locked && !picking && (
              <button
                onClick={() => {
                  if (window.confirm("Remove the customer from this sale?")) void save(null);
                }}
                disabled={busy}
                className="text-sm text-red-700 hover:underline ml-auto"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ) : (
        !picking && <p className="text-sm text-carbon-text-muted">No customer on this sale.</p>
      )}

      {locked && (
        <p className="text-xs text-carbon-text-muted mt-2">Store credit was used on this sale, so the customer is locked.</p>
      )}

      {picking && (
        <div className="mt-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email or phone"
            className="carbon-input tap w-full px-3"
          />
          {results.length > 0 && (
            <ul className="mt-2 border border-carbon-border-soft divide-y divide-[var(--color-pos-border)] max-h-64 overflow-auto">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => void save(c.id)}
                    disabled={busy}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--color-pos-bg)] disabled:opacity-50"
                  >
                    <span className="font-semibold">
                      {[c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed"}
                    </span>
                    <span className="block text-xs text-carbon-text-muted">
                      {[c.email, c.phone].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && results.length === 0 && (
            <p className="text-xs text-carbon-text-muted mt-2">No matches.</p>
          )}
          <div className="flex justify-between mt-3">
            <Link href={`/customers/${code}/new`} className="text-sm font-semibold text-carbon-blue hover:underline">
              + New customer
            </Link>
            <button onClick={() => { setPicking(false); setQ(""); }} className="text-sm text-carbon-text-muted hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-[var(--color-pos-bg)] p-2 text-center">
      <dd className="font-bold tabular-nums">{v}</dd>
      <dt className="text-xs text-carbon-text-muted">{k}</dt>
    </div>
  );
}
