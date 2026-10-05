"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/utils";

type SaleSummary = {
  id: number;
  sale_number: string;
  total_amount: string;
  completed_at: string | null;
};

type SaleDetail = {
  sale: SaleSummary & {
    status: string;
    customer_id: number | null;
    customer_first_name?: string | null;
    customer_last_name?: string | null;
    customer_email?: string | null;
  };
  lines: Array<{
    id: number;
    description: string;
    quantity: number;
    line_total: string;
    line_type: string;
  }>;
  returned_line_ids?: number[];
  refunded_total?: number;
};

/**
 * Pick the original sale and the items coming back, then hand off to the
 * sell screen with the exchange credit (localStorage pos:exchange:{code};
 * the sale's customer rides along on the URL).
 */
export function ExchangeClient({ code }: { code: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SaleSummary[]>([]);
  const [picked, setPicked] = useState<SaleDetail | null>(null);
  const [ticked, setTicked] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/pos/sales?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) return;
      setResults(((await res.json()) as { sales?: SaleSummary[] }).sales ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function pick(s: SaleSummary) {
    const res = await fetch(`/api/pos/sales/${s.id}`);
    if (!res.ok) return;
    const d = (await res.json()) as SaleDetail;
    setPicked(d);
    setTicked({});
  }

  const returned = new Set(picked?.returned_line_ids ?? []);
  const lines = (picked?.lines ?? []).filter((l) => l.line_type !== "loyalty_redemption");
  const chosen = lines.filter((l) => ticked[l.id] && !returned.has(l.id));
  const value = chosen.reduce((s, l) => s + Number(l.line_total), 0);
  const remaining = picked
    ? Math.max(0, Number(picked.sale.total_amount) - Number(picked.refunded_total ?? 0))
    : 0;
  const credit = Math.round(Math.min(value, remaining) * 100) / 100;

  function continueToCart() {
    if (!picked || chosen.length === 0 || credit <= 0) return;
    try {
      localStorage.setItem(
        `pos:exchange:${code}`,
        JSON.stringify({
          sale_id: picked.sale.id,
          sale_number: picked.sale.sale_number,
          line_ids: chosen.map((l) => l.id),
          credit,
          items: chosen.map((l) => l.description),
        }),
      );
    } catch {
      /* storage unavailable — the cart page shows no exchange */
    }
    const s = picked.sale;
    const qs = new URLSearchParams();
    if (s.customer_id) {
      qs.set("customer_id", String(s.customer_id));
      qs.set(
        "customer_name",
        [s.customer_first_name, s.customer_last_name].filter(Boolean).join(" "),
      );
      if (s.customer_email) qs.set("customer_email", s.customer_email);
    }
    router.push(`/sales/${code}/new${qs.toString() ? `?${qs}` : ""}`);
  }

  if (!picked) {
    return (
      <>
        <h1 className="text-2xl font-bold">Exchange</h1>
        <p className="text-sm text-carbon-text-muted mt-1 mb-4">
          Find the original receipt, pick what&apos;s coming back, then ring up
          the new items. The customer pays only the difference.
        </p>
        <input
          type="text"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Receipt number or customer name"
          className="tap-lg w-full border border-[var(--color-pos-border)] bg-white px-5 text-lg"
        />
        <ul className="mt-3 bg-white border border-[var(--color-pos-border)]">
          {results.length === 0 ? (
            <li className="p-4 text-[var(--color-pos-muted)]">
              Scan or type the receipt number, or the customer&apos;s name.
            </li>
          ) : (
            results.map((r) => (
              <li key={r.id} className="border-b border-[var(--color-pos-border)] last:border-b-0">
                <button
                  onClick={() => void pick(r)}
                  className="w-full text-left px-4 py-3 hover:bg-[var(--color-pos-bg)]"
                >
                  <div className="flex justify-between">
                    <span className="font-medium">{r.sale_number}</span>
                    <span>{formatMoney(r.total_amount)}</span>
                  </div>
                  <p className="text-xs text-[var(--color-pos-muted)]">
                    {r.completed_at &&
                      new Date(r.completed_at).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                      })}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
        <Link href={`/sales/${code}`} className="inline-block mt-4 text-sm underline text-[var(--color-pos-muted)]">
          ← Back to Sales
        </Link>
      </>
    );
  }

  const customerName = [picked.sale.customer_first_name, picked.sale.customer_last_name]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <h1 className="text-2xl font-bold">Exchange — sale #{picked.sale.sale_number}</h1>
      <p className="text-sm text-carbon-text-muted mt-1 mb-4">
        {formatMoney(picked.sale.total_amount)}
        {customerName ? ` · ${customerName}` : " · no customer on this sale"}
        {picked.sale.status === "voided" ? " · VOIDED" : ""}
      </p>
      <div className="bg-white border border-[var(--color-pos-border)] p-4">
        <p className="font-semibold mb-2">Which items are coming back?</p>
        <ul className="border-t border-[var(--color-pos-border)]">
          {lines.map((l) => {
            const done = returned.has(l.id);
            return (
              <li
                key={l.id}
                className={`flex items-center gap-3 py-2 border-b border-[var(--color-pos-border)] last:border-b-0 ${done ? "opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  className="w-5 h-5"
                  disabled={done}
                  checked={!done && !!ticked[l.id]}
                  onChange={(e) => setTicked((m) => ({ ...m, [l.id]: e.target.checked }))}
                />
                <div className="flex-1">
                  <p>{l.description}</p>
                  <p className="text-xs text-[var(--color-pos-muted)]">
                    Qty {l.quantity}
                    {done ? " · Already returned" : ""}
                  </p>
                </div>
                <span className={`font-semibold ${done ? "line-through" : ""}`}>
                  {formatMoney(l.line_total)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-between items-center">
          <span className="text-[var(--color-pos-muted)]">Exchange credit</span>
          <span className="total-display text-3xl">{formatMoney(credit)}</span>
        </div>
        {value > remaining + 0.005 && (
          <p className="text-xs text-carbon-text-muted mt-1">
            Capped at {formatMoney(remaining)} — the amount still refundable on this sale.
          </p>
        )}
        <button
          onClick={continueToCart}
          disabled={chosen.length === 0 || credit <= 0 || picked.sale.status === "voided"}
          className="tap-lg w-full carbon-btn-primary text-xl font-semibold mt-4 disabled:opacity-50"
        >
          Continue — add the new items
        </button>
        <button
          onClick={() => setPicked(null)}
          className="tap w-full mt-2 text-sm underline text-[var(--color-pos-muted)]"
        >
          Pick a different sale
        </button>
      </div>
    </>
  );
}
