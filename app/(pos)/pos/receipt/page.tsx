"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMoney } from "@/lib/utils";

type SaleDetail = {
  sale: {
    id: number;
    sale_number: string;
    location_name: string;
    register_name: string;
    cashier_email: string;
    subtotal: string;
    discount_amount: string;
    tax_amount: string;
    total_amount: string;
    completed_at: string | null;
    created_at: string;
    customer_email: string | null;
    receipt_footer: string | null;
    return_policy: string | null;
  };
  lines: Array<{
    id: number;
    description: string;
    quantity: number;
    line_total: string;
  }>;
  payments: Array<{
    id: number;
    method: string;
    amount: string;
    change_given: string | null;
  }>;
};

function ReceiptInner() {
  const params = useSearchParams();
  const router = useRouter();
  const saleId = Number(params.get("sale"));
  const [data, setData] = useState<SaleDetail | null>(null);
  const [printState, setPrintState] = useState<"idle" | "printing" | "done" | "error">(
    "idle",
  );
  const [emailValue, setEmailValue] = useState("");
  const [emailState, setEmailState] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(saleId)) return;
    fetch(`/api/pos/sales/${saleId}`)
      .then((r) => r.json())
      .then((d: SaleDetail) => {
        setData(d);
        if (d?.sale?.customer_email) setEmailValue(d.sale.customer_email);
      });
  }, [saleId]);

  async function print() {
    setPrintState("printing");
    setErrorMsg(null);
    const res = await fetch(`/api/pos/sales/${saleId}/print`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.message ?? "Couldn't reach the printer.");
      setPrintState("error");
      return;
    }
    setPrintState("done");
  }

  async function sendEmail() {
    if (!emailValue.trim()) return;
    setEmailState("sending");
    setErrorMsg(null);
    const res = await fetch(`/api/pos/sales/${saleId}/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailValue.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.message ?? "Couldn't send the email.");
      setEmailState("error");
      return;
    }
    setEmailState("done");
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--color-pos-muted)]">Loading receipt…</p>
      </main>
    );
  }
  const { sale, lines, payments } = data;
  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-6">
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold">{sale.location_name}</h1>
          <p className="text-[var(--color-pos-muted)] text-sm">
            Sale {sale.sale_number} · {sale.register_name}
          </p>
          <p className="text-[var(--color-pos-muted)] text-sm">
            {new Date(sale.completed_at ?? sale.created_at).toLocaleString()}
          </p>
        </div>
        <ul className="border-t border-[var(--color-pos-border)] pt-3">
          {lines.map((l) => (
            <li
              key={l.id}
              className="flex justify-between py-1 text-sm"
            >
              <span>
                {l.quantity}× {l.description}
              </span>
              <span className="tabular-nums">{formatMoney(l.line_total)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-[var(--color-pos-border)] pt-3 grid grid-cols-2 gap-y-1 text-sm">
          <span>Subtotal</span>
          <span className="text-right">{formatMoney(sale.subtotal)}</span>
          <span>Discount</span>
          <span className="text-right">−{formatMoney(sale.discount_amount)}</span>
          <span>Tax</span>
          <span className="text-right">{formatMoney(sale.tax_amount)}</span>
          <span className="font-bold text-lg">Total</span>
          <span className="text-right font-bold text-lg">
            {formatMoney(sale.total_amount)}
          </span>
        </div>
        <div className="mt-3 border-t border-[var(--color-pos-border)] pt-3 grid grid-cols-2 gap-y-1 text-sm">
          {payments.map((p) => (
            <span key={p.id} className="contents">
              <span>{humanMethod(p.method)}</span>
              <span className="text-right">{formatMoney(p.amount)}</span>
              {p.method === "cash" && p.change_given ? (
                <>
                  <span className="text-[var(--color-pos-muted)]">Change</span>
                  <span className="text-right text-[var(--color-pos-muted)]">
                    {formatMoney(p.change_given)}
                  </span>
                </>
              ) : null}
            </span>
          ))}
        </div>
        {sale.return_policy && (
          <p className="mt-4 text-center text-xs text-[var(--color-pos-muted)]">
            {sale.return_policy}
          </p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={print}
          disabled={printState === "printing"}
          className="tap-lg rounded-2xl bg-[var(--color-pos-ink)] text-white text-lg font-semibold"
        >
          {printState === "printing"
            ? "Printing…"
            : printState === "done"
              ? "Printed ✓ — Print again"
              : "Print Receipt"}
        </button>
        <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-3 flex flex-col gap-2">
          <input
            type="email"
            value={emailValue}
            onChange={(e) => setEmailValue(e.target.value)}
            placeholder="customer@email.com"
            className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
          />
          <button
            onClick={sendEmail}
            disabled={!emailValue.trim() || emailState === "sending"}
            className="tap rounded-xl bg-white border border-[var(--color-pos-border)] font-semibold"
          >
            {emailState === "sending"
              ? "Sending…"
              : emailState === "done"
                ? "Sent ✓"
                : "Email Receipt"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <p className="mt-4 text-center text-[var(--color-pos-danger)]">{errorMsg}</p>
      )}

      <button
        onClick={() => router.replace("/pos")}
        className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent)] text-white text-xl font-semibold mt-4"
      >
        New Sale
      </button>
    </main>
  );
}

export default function ReceiptPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-[var(--color-pos-muted)]">Loading…</p>
        </main>
      }
    >
      <ReceiptInner />
    </Suspense>
  );
}

function humanMethod(m: string): string {
  return {
    card: "Card",
    cash: "Cash",
    check: "Check",
    store_credit: "Store credit",
  }[m] ?? m;
}
