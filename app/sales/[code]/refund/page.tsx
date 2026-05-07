"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatMoney } from "@/lib/utils";

type SaleSummary = {
  id: number;
  sale_number: string;
  total_amount: string;
  completed_at: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
};

type SaleDetail = {
  sale: SaleSummary & {
    location_name: string;
    register_name: string;
  };
  lines: Array<{
    id: number;
    description: string;
    quantity: number;
    line_total: string;
  }>;
  payments: Array<{
    id: number;
    method: "card" | "cash" | "check" | "store_credit";
    amount: string;
  }>;
};

export default function RefundPage() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SaleSummary[]>([]);
  const [picked, setPicked] = useState<SaleDetail | null>(null);
  const [pickedLineIds, setPickedLineIds] = useState<Record<number, boolean>>(
    {},
  );
  const [method, setMethod] = useState<
    "original_card" | "cash" | "store_credit"
  >("original_card");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number } | null>(null);

  useEffect(() => {
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/pos/sales?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.sales ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function pick(s: SaleSummary) {
    const res = await fetch(`/api/pos/sales/${s.id}`);
    if (!res.ok) return;
    const data: SaleDetail = await res.json();
    setPicked(data);
    setPickedLineIds(
      Object.fromEntries(data.lines.map((l) => [l.id, true])),
    );
  }

  const refundAmount = picked
    ? picked.lines
        .filter((l) => pickedLineIds[l.id])
        .reduce((s, l) => s + Number(l.line_total), 0)
    : 0;

  async function submit() {
    if (!picked || refundAmount <= 0) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pos/payment/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sale_id: picked.sale.id,
        amount: Number(refundAmount.toFixed(2)),
        reason,
        method,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Couldn't refund. Try again.");
      return;
    }
    setDone({ amount: refundAmount });
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-[var(--color-pos-border)] p-8 max-w-md w-full text-center">
          <p className="text-[var(--color-pos-muted)]">Refunded</p>
          <p className="total-display text-4xl mt-1">
            {formatMoney(done.amount)}
          </p>
          <button
            onClick={() => router.replace(`/sales/${code}`)}
            className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent)] text-white text-xl font-semibold mt-6"
          >
            Done
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Refund a sale</h1>
        <button
          onClick={() => router.push(`/sales/${code}`)}
          className="tap text-[var(--color-pos-muted)] underline px-3"
        >
          Cancel
        </button>
      </header>

      {!picked ? (
        <>
          <input
            type="text"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sale number (POS-…) or customer name"
            className="tap-lg w-full rounded-2xl border border-[var(--color-pos-border)] bg-white px-5 text-lg"
          />
          <ul className="mt-3 bg-white border border-[var(--color-pos-border)] rounded-2xl overflow-hidden">
            {results.length === 0 ? (
              <li className="p-4 text-[var(--color-pos-muted)]">
                Type the sale number or the customer's name.
              </li>
            ) : (
              results.map((r) => (
                <li
                  key={r.id}
                  className="border-b border-[var(--color-pos-border)] last:border-b-0"
                >
                  <button
                    onClick={() => pick(r)}
                    className="w-full text-left px-4 py-3 hover:bg-[var(--color-pos-bg)]"
                  >
                    <div className="flex justify-between">
                      <span className="font-medium">{r.sale_number}</span>
                      <span>{formatMoney(r.total_amount)}</span>
                    </div>
                    <p className="text-xs text-[var(--color-pos-muted)]">
                      {r.completed_at &&
                        new Date(r.completed_at).toLocaleString()}
                    </p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      ) : (
        <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-5">
          <p className="font-medium mb-3">
            {picked.sale.sale_number} · {formatMoney(picked.sale.total_amount)}
          </p>
          <ul className="border-t border-[var(--color-pos-border)] pt-2">
            {picked.lines.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-3 py-2 border-b border-[var(--color-pos-border)] last:border-b-0"
              >
                <input
                  type="checkbox"
                  checked={!!pickedLineIds[l.id]}
                  onChange={(e) =>
                    setPickedLineIds((m) => ({
                      ...m,
                      [l.id]: e.target.checked,
                    }))
                  }
                  className="w-5 h-5"
                />
                <div className="flex-1">
                  <p>{l.description}</p>
                  <p className="text-xs text-[var(--color-pos-muted)]">
                    Qty {l.quantity}
                  </p>
                </div>
                <span className="font-semibold">
                  {formatMoney(l.line_total)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <label className="text-sm font-medium">Refund as</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <MethodTab
                active={method === "original_card"}
                onClick={() => setMethod("original_card")}
                label="Original card"
              />
              <MethodTab
                active={method === "cash"}
                onClick={() => setMethod("cash")}
                label="Cash"
              />
              <MethodTab
                active={method === "store_credit"}
                onClick={() => setMethod("store_credit")}
                label="Store credit"
              />
            </div>
          </div>
          <label className="block mt-3 text-sm font-medium">
            Reason (optional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-3 mt-1"
            placeholder="e.g. Wrong size"
          />
          <div className="mt-5 flex justify-between items-center">
            <span className="text-[var(--color-pos-muted)]">Refund total</span>
            <span className="total-display text-3xl">
              {formatMoney(refundAmount)}
            </span>
          </div>
          <button
            onClick={submit}
            disabled={busy || refundAmount <= 0}
            className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent)] text-white text-xl font-semibold mt-3 disabled:opacity-50"
          >
            {busy ? "Refunding…" : "Refund"}
          </button>
          {error && (
            <p className="mt-3 text-center text-[var(--color-pos-danger)]">
              {error}
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function MethodTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`tap rounded-xl font-medium ${
        active
          ? "bg-[var(--color-pos-ink)] text-white"
          : "bg-white border border-[var(--color-pos-border)]"
      }`}
    >
      {label}
    </button>
  );
}
