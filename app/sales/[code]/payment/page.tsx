"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { formatMoney, round2 } from "@/lib/utils";
import { CashKeypad } from "@/components/pos/CashKeypad";
import { PaymentModal } from "@/components/pos/PaymentModal";
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
  const { code } = useParams<{ code: string }>();
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
  const [readerId, setReaderId] = useState<string | null>(null);

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

  // Look up the reader paired with this register so the PaymentModal knows
  // where to send the amount.
  useEffect(() => {
    if (!registerId) return;
    fetch("/api/pos/registers")
      .then((r) => r.json())
      .then((d) => {
        const reg = (d?.registers ?? []).find(
          (r: { id: number; stripe_reader_id: string | null }) =>
            r.id === registerId,
        );
        setReaderId(reg?.stripe_reader_id ?? null);
      });
  }, [registerId]);

  if (!cart) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-[var(--color-pos-border)] p-8 text-center">
          <p className="font-medium mb-2">We lost the cart.</p>
          <p className="text-[var(--color-pos-muted)] mb-4">
            Go back to the sell screen and start the sale again.
          </p>
          <button
            onClick={() => router.push(`/sales/${code}/new`)}
            className="tap rounded-xl bg-[var(--color-pos-ink)] text-white px-5 font-semibold"
          >
            Back to Register
          </button>
        </div>
      </main>
    );
  }

  const total = cart.totals.total;
  const cashAmount = round2(Number(cashGiven || 0));
  const splitCardAmt = round2(Number(splitCard || 0));
  const splitCashAmt = round2(Number(splitCash || 0));
  const splitOk =
    !splitOn || Math.abs(splitCardAmt + splitCashAmt - total) < 0.01;

  async function finishSale(payments: SubmitPayment[]) {
    if (!cart) return;
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
    router.replace(`/sales/${code}/receipt?sale=${data.sale.id}`);
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.back()}
          className="tap text-[var(--color-pos-muted)] underline px-3"
        >
          ← Back to cart
        </button>
        <div className="text-right">
          <p className="text-[var(--color-pos-muted)] text-sm">Amount due</p>
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
        <PaymentModal
          amount={total}
          readerId={readerId}
          saving={saving}
          onCancel={() => router.back()}
          onApprove={(intentId) =>
            finishSale([
              {
                method: "card",
                amount: total,
                payment_intent_id: intentId,
                reader_id: readerId,
              },
            ])
          }
        />
      )}

      {method === "cash" && !splitOn && (
        <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-6">
          <CashKeypad value={cashGiven} onChange={setCashGiven} total={total} />
          <button
            disabled={cashAmount < total || saving}
            onClick={() =>
              finishSale([
                {
                  method: "cash",
                  amount: total,
                  cash_given: cashAmount,
                },
              ])
            }
            className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent-2)] text-white text-xl font-semibold disabled:opacity-50 mt-4"
          >
            {saving
              ? "Saving…"
              : cashAmount >= total
                ? "Finish Sale"
                : `Need ${formatMoney(total)} or more`}
          </button>
        </div>
      )}

      {method === "other" && !splitOn && (
        <OtherSection
          total={total}
          saving={saving}
          onStoreCredit={() =>
            finishSale([{ method: "store_credit", amount: total }])
          }
          onAccount={(reference) =>
            finishSale([
              { method: "account", amount: total, reference: reference || null },
            ])
          }
          onGiftCard={(giftCardNumber) =>
            finishSale([
              {
                method: "gift_card",
                amount: total,
                gift_card_number: giftCardNumber,
              },
            ])
          }
        />
      )}

      <div className="mt-5 bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium">Split payment</span>
          <button
            onClick={() => setSplitOn((v) => !v)}
            className={`tap rounded-full px-4 ${
              splitOn
                ? "bg-[var(--color-pos-ink)] text-white"
                : "bg-[var(--color-pos-bg)] border border-[var(--color-pos-border)]"
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
                className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-3 mt-1"
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
                className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-3 mt-1"
              />
            </label>
            <p
              className={`col-span-2 text-sm ${
                splitOk
                  ? "text-[var(--color-pos-muted)]"
                  : "text-[var(--color-pos-danger)]"
              }`}
            >
              {splitOk
                ? "Amounts balance — ready when you are."
                : `These need to add up to ${formatMoney(total)}. Currently ${formatMoney(
                    splitCardAmt + splitCashAmt,
                  )}.`}
            </p>
            <p className="col-span-2 text-xs text-[var(--color-pos-muted)]">
              Split sales charge the cash portion now and the card portion via
              the reader as a separate payment. (Phase 2 will run them in one
              flow.)
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 text-center text-[var(--color-pos-danger)]">
          {error}
        </p>
      )}
    </main>
  );
}

export default function PaymentPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-[var(--color-pos-muted)]">Loading…</p>
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
  | { method: "store_credit"; amount: number }
  | { method: "account"; amount: number; reference: string | null }
  | { method: "gift_card"; amount: number; gift_card_number: string };

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
          ? "bg-[var(--color-pos-ink)] text-white"
          : "bg-white border border-[var(--color-pos-border)]"
      }`}
    >
      {label}
    </button>
  );
}

function OtherSection({
  total,
  saving,
  onStoreCredit,
  onAccount,
  onGiftCard,
}: {
  total: number;
  saving: boolean;
  onStoreCredit: () => void;
  onAccount: (reference: string) => void;
  onGiftCard: (cardNumber: string) => void;
}) {
  const [accountRef, setAccountRef] = useState("");
  const [giftCardNumber, setGiftCardNumber] = useState("");
  return (
    <div className="carbon-card p-6 flex flex-col gap-5">
      {/* Store Credit */}
      <div>
        <p className="font-bold text-carbon-text mb-1">Store Credit</p>
        <p className="text-sm text-carbon-text-muted mb-3">
          Applies the customer&apos;s store credit balance to this sale.
        </p>
        <button
          type="button"
          disabled={saving}
          onClick={onStoreCredit}
          className="carbon-btn-secondary tap w-full font-semibold disabled:opacity-50"
        >
          Use store credit ({formatMoney(total)})
        </button>
      </div>

      {/* Account */}
      <div className="border-t border-carbon-border-soft pt-5">
        <p className="font-bold text-carbon-text mb-1">Charge to Account</p>
        <p className="text-sm text-carbon-text-muted mb-3">
          Charges the customer&apos;s house account on file. Reference is
          optional (PO number, note for the receipt).
        </p>
        <input
          type="text"
          value={accountRef}
          onChange={(e) => setAccountRef(e.target.value)}
          placeholder="Reference (optional)"
          className="carbon-input tap w-full px-3 mb-2"
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => onAccount(accountRef.trim())}
          className="carbon-btn-primary tap w-full font-semibold disabled:opacity-50"
        >
          Charge {formatMoney(total)} to account
        </button>
      </div>

      {/* Gift Card */}
      <div className="border-t border-carbon-border-soft pt-5">
        <p className="font-bold text-carbon-text mb-1">Gift Card</p>
        <p className="text-sm text-carbon-text-muted mb-3">
          Apply a gift card to this sale. Enter the card number / serial
          printed on the back.
        </p>
        <input
          type="text"
          value={giftCardNumber}
          onChange={(e) => setGiftCardNumber(e.target.value)}
          placeholder="Gift card number"
          className="carbon-input tap w-full px-3 mb-2"
        />
        <button
          type="button"
          disabled={!giftCardNumber.trim() || saving}
          onClick={() => onGiftCard(giftCardNumber.trim())}
          className="carbon-btn-primary tap w-full font-semibold disabled:opacity-50"
        >
          Pay {formatMoney(total)} with gift card
        </button>
      </div>
    </div>
  );
}
