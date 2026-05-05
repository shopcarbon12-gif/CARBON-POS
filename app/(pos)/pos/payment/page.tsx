"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMoney, round2 } from "@/lib/utils";
import type { CartLine, CartTotals } from "@/types/pos";

type CartPayload = {
  lines: CartLine[];
  totals: CartTotals;
  customerName: string | null;
  taxRate: number;
};

type Method = "card" | "cash" | "other";

function PaymentInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initialMethod = (params.get("method") ?? "card") as Method;
  const cartParam = params.get("cart");

  const cart = useMemo<CartPayload | null>(() => {
    if (!cartParam) return null;
    try {
      return JSON.parse(decodeURIComponent(cartParam));
    } catch {
      return null;
    }
  }, [cartParam]);

  const [method, setMethod] = useState<Method>(initialMethod);
  const [registerId, setRegisterId] = useState<number | null>(null);

  // Card flow state
  const [cardStatus, setCardStatus] = useState<
    "idle" | "starting" | "waiting" | "approved" | "declined" | "error"
  >("idle");
  const [cardMessage, setCardMessage] = useState<string | null>(null);
  const [cardIntentId, setCardIntentId] = useState<string | null>(null);

  // Cash flow state
  const [cashGiven, setCashGiven] = useState("");

  const [splitOn, setSplitOn] = useState(false);
  const [splitCard, setSplitCard] = useState("");
  const [splitCash, setSplitCash] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pos/sessions?current=1")
      .then((r) => r.json())
      .then((d) => {
        if (d?.session?.register_id) setRegisterId(d.session.register_id);
      });
  }, []);

  if (!cart) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-[--color-pos-border] p-8 text-center">
          <p className="font-medium mb-2">We lost the cart.</p>
          <p className="text-[--color-pos-muted] mb-4">
            Go back to the sell screen and start the sale again.
          </p>
          <button
            onClick={() => router.push("/pos")}
            className="tap rounded-xl bg-[--color-pos-ink] text-white px-5 font-semibold"
          >
            Back to Register
          </button>
        </div>
      </main>
    );
  }

  const total = cart.totals.total;
  const cashAmount = round2(Number(cashGiven || 0));
  const change = round2(Math.max(0, cashAmount - total));
  const splitCardAmt = round2(Number(splitCard || 0));
  const splitCashAmt = round2(Number(splitCash || 0));
  const splitOk =
    !splitOn ||
    Math.abs(splitCardAmt + splitCashAmt - total) < 0.01;

  async function startCardPayment(amount: number) {
    setCardStatus("starting");
    setCardMessage("Setting up the card reader…");
    setError(null);
    try {
      const res = await fetch("/api/pos/payment/create-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, description: `Carbon POS sale` }),
      });
      if (!res.ok) throw new Error("create_intent_failed");
      const data = await res.json();
      setCardIntentId(data.id);
      // In Phase 1 we ship the server-driven flow only. The browser would
      // call stripe-terminal-js here to dispatch to a paired reader. For
      // dev with a simulated reader, you can also call stripe.test_helpers
      // server-side to mark it succeeded. We simulate "waiting" here.
      setCardStatus("waiting");
      setCardMessage(
        "Hand the reader to the customer. Waiting for them to tap or insert their card…",
      );
    } catch (err) {
      console.error(err);
      setCardStatus("error");
      setCardMessage(
        "Couldn't start the card payment. Try again or take cash.",
      );
    }
  }

  async function finishSale(payments: SubmitPayment[]) {
    if (!registerId) {
      setError("Your register isn't open. Go to the Register screen first.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/pos/payment/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        register_id: registerId,
        lines: cart.lines.map((l) => ({
          sku_id: l.sku_id,
          epc: l.epc,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          discount_amount: l.discount_amount,
          tax_rate: l.tax_rate,
          line_type: l.line_type,
        })),
        payments,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Couldn't finish the sale. Try again.");
      return;
    }
    const data = await res.json();
    router.replace(`/pos/receipt?sale=${data.sale.id}`);
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.back()}
          className="tap text-[--color-pos-muted] underline px-3"
        >
          ← Back to cart
        </button>
        <div className="text-right">
          <p className="text-[--color-pos-muted] text-sm">Amount due</p>
          <p className="total-display text-3xl">{formatMoney(total)}</p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <MethodTab
          active={method === "card"}
          onClick={() => setMethod("card")}
          label="Card"
        />
        <MethodTab
          active={method === "cash"}
          onClick={() => setMethod("cash")}
          label="Cash"
        />
        <MethodTab
          active={method === "other"}
          onClick={() => setMethod("other")}
          label="Other"
        />
      </div>

      {method === "card" && !splitOn && (
        <CardSection
          status={cardStatus}
          message={cardMessage}
          onStart={() => startCardPayment(total)}
          onFinish={() =>
            finishSale([
              {
                method: "card",
                amount: total,
                payment_intent_id: cardIntentId ?? "",
                reader_id: null,
              },
            ])
          }
          ready={cardStatus === "waiting" && !!cardIntentId}
          saving={saving}
        />
      )}

      {method === "cash" && !splitOn && (
        <CashSection
          total={total}
          cashGiven={cashGiven}
          setCashGiven={setCashGiven}
          change={change}
          onFinish={() =>
            finishSale([
              {
                method: "cash",
                amount: total,
                cash_given: cashAmount,
              },
            ])
          }
          ready={cashAmount >= total}
          saving={saving}
        />
      )}

      {method === "other" && !splitOn && (
        <OtherSection
          total={total}
          saving={saving}
          onCheck={(checkNumber) =>
            finishSale([
              { method: "check", amount: total, check_number: checkNumber },
            ])
          }
          onStoreCredit={() =>
            finishSale([{ method: "store_credit", amount: total }])
          }
        />
      )}

      <div className="mt-5 bg-white border border-[--color-pos-border] rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium">Split payment</span>
          <button
            onClick={() => setSplitOn((v) => !v)}
            className={`tap rounded-full px-4 ${
              splitOn
                ? "bg-[--color-pos-ink] text-white"
                : "bg-[--color-pos-bg] border border-[--color-pos-border]"
            }`}
          >
            {splitOn ? "On" : "Off"}
          </button>
        </div>
        {splitOn && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">
              Card
              <input
                type="number"
                step="0.01"
                min="0"
                value={splitCard}
                onChange={(e) => setSplitCard(e.target.value)}
                className="tap w-full rounded-lg border border-[--color-pos-border] px-3 mt-1"
              />
            </label>
            <label className="text-sm font-medium">
              Cash
              <input
                type="number"
                step="0.01"
                min="0"
                value={splitCash}
                onChange={(e) => setSplitCash(e.target.value)}
                className="tap w-full rounded-lg border border-[--color-pos-border] px-3 mt-1"
              />
            </label>
            <p
              className={`col-span-2 text-sm ${
                splitOk ? "text-[--color-pos-muted]" : "text-[--color-pos-danger]"
              }`}
            >
              {splitOk
                ? "Amounts balance — ready when you are."
                : `These need to add up to ${formatMoney(total)}. Currently ${formatMoney(
                    splitCardAmt + splitCashAmt,
                  )}.`}
            </p>
            <button
              disabled={!splitOk || saving}
              onClick={() =>
                finishSale([
                  {
                    method: "card",
                    amount: splitCardAmt,
                    payment_intent_id: cardIntentId ?? "",
                    reader_id: null,
                  },
                  {
                    method: "cash",
                    amount: splitCashAmt,
                    cash_given: splitCashAmt,
                  },
                ])
              }
              className="col-span-2 tap-lg rounded-2xl bg-[--color-pos-accent] text-white font-semibold disabled:opacity-50"
            >
              {saving ? "Saving…" : "Finish Split Sale"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 text-center text-[--color-pos-danger]">{error}</p>
      )}
    </main>
  );
}

export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-[--color-pos-muted]">Loading…</p>
        </main>
      }
    >
      <PaymentInner />
    </Suspense>
  );
}

type SubmitPayment =
  | {
      method: "card";
      amount: number;
      payment_intent_id: string;
      reader_id: string | null;
    }
  | { method: "cash"; amount: number; cash_given: number }
  | { method: "check"; amount: number; check_number: string }
  | { method: "store_credit"; amount: number };

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
      className={`tap rounded-xl font-semibold ${
        active
          ? "bg-[--color-pos-ink] text-white"
          : "bg-white border border-[--color-pos-border]"
      }`}
    >
      {label}
    </button>
  );
}

function CardSection({
  status,
  message,
  onStart,
  onFinish,
  ready,
  saving,
}: {
  status: string;
  message: string | null;
  onStart: () => void;
  onFinish: () => void;
  ready: boolean;
  saving: boolean;
}) {
  return (
    <div className="bg-white border border-[--color-pos-border] rounded-2xl p-6">
      <p className="text-[--color-pos-muted] mb-4">
        Tap the button to send the amount to the card reader. The customer
        taps, inserts, or swipes their card on the reader itself.
      </p>
      {status === "idle" ? (
        <button
          onClick={onStart}
          className="tap-lg w-full rounded-2xl bg-[--color-pos-accent] text-white text-xl font-semibold"
        >
          Send to Reader
        </button>
      ) : (
        <div className="text-center py-6">
          <p className="font-medium">{message}</p>
          {status === "declined" && (
            <p className="mt-2 text-[--color-pos-danger]">
              The card was declined. Ask the customer to try a different card.
            </p>
          )}
          <button
            disabled={!ready || saving}
            onClick={onFinish}
            className="tap-lg w-full rounded-2xl bg-[--color-pos-ink] text-white text-xl font-semibold mt-5 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Approved — Finish Sale"}
          </button>
        </div>
      )}
    </div>
  );
}

function CashSection({
  total,
  cashGiven,
  setCashGiven,
  change,
  onFinish,
  ready,
  saving,
}: {
  total: number;
  cashGiven: string;
  setCashGiven: (v: string) => void;
  change: number;
  onFinish: () => void;
  ready: boolean;
  saving: boolean;
}) {
  const quick = [1, 5, 10, 20, 50, 100];
  return (
    <div className="bg-white border border-[--color-pos-border] rounded-2xl p-6">
      <p className="text-[--color-pos-muted] mb-3">
        Type how much cash the customer handed over. We'll show the change.
      </p>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={cashGiven}
        onChange={(e) => setCashGiven(e.target.value)}
        autoFocus
        className="tap-lg w-full rounded-2xl border border-[--color-pos-border] text-3xl font-semibold px-4 mb-3"
        placeholder="0.00"
      />
      <div className="grid grid-cols-3 gap-2 mb-4">
        {quick.map((q) => (
          <button
            key={q}
            onClick={() => setCashGiven(String(q))}
            className="tap rounded-lg border border-[--color-pos-border] font-semibold"
          >
            ${q}
          </button>
        ))}
      </div>
      <div className="flex justify-between items-center mb-4">
        <span className="text-[--color-pos-muted]">Change</span>
        <span className="total-display text-3xl">{formatMoney(change)}</span>
      </div>
      <button
        disabled={!ready || saving}
        onClick={onFinish}
        className="tap-lg w-full rounded-2xl bg-[--color-pos-accent-2] text-white text-xl font-semibold disabled:opacity-50"
      >
        {saving
          ? "Saving…"
          : ready
            ? "Finish Sale"
            : `Need ${formatMoney(total)} or more`}
      </button>
    </div>
  );
}

function OtherSection({
  total,
  saving,
  onCheck,
  onStoreCredit,
}: {
  total: number;
  saving: boolean;
  onCheck: (n: string) => void;
  onStoreCredit: () => void;
}) {
  const [checkNumber, setCheckNumber] = useState("");
  return (
    <div className="bg-white border border-[--color-pos-border] rounded-2xl p-6 flex flex-col gap-4">
      <div>
        <p className="font-medium mb-1">Check</p>
        <input
          type="text"
          value={checkNumber}
          onChange={(e) => setCheckNumber(e.target.value)}
          placeholder="Check number"
          className="tap w-full rounded-lg border border-[--color-pos-border] px-3"
        />
        <button
          disabled={!checkNumber.trim() || saving}
          onClick={() => onCheck(checkNumber.trim())}
          className="tap rounded-xl bg-[--color-pos-ink] text-white font-semibold mt-2 w-full disabled:opacity-50"
        >
          Take {formatMoney(total)} by check
        </button>
      </div>
      <div className="border-t border-[--color-pos-border] pt-4">
        <p className="font-medium mb-1">Store Credit</p>
        <p className="text-sm text-[--color-pos-muted] mb-2">
          Applies the customer's store credit balance to this sale.
        </p>
        <button
          disabled={saving}
          onClick={onStoreCredit}
          className="tap rounded-xl bg-white border border-[--color-pos-border] font-semibold w-full"
        >
          Use store credit ({formatMoney(total)})
        </button>
      </div>
    </div>
  );
}
