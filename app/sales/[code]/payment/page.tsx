"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { formatMoney, round2 } from "@/lib/utils";
import { CashKeypad } from "@/components/pos/CashKeypad";
import { PaymentModal } from "@/components/pos/PaymentModal";
import { SplitBuilder, type Tender } from "@/components/pos/SplitBuilder";
import type { CartLine, CartTotals } from "@/types/pos";
import { captureLines } from "@/lib/capture-payload";
import { calculateTotals } from "@/lib/tax";

type CartPayload = {
  lines: CartLine[];
  totals: CartTotals;
  customerName: string | null;
  customerId?: number | null;
  taxRate: number;
  /** Sale-wide attributed employee, set in the cart-header dropdown.
   *  Forwarded to /api/pos/payment/capture so the persisted sale row
   *  records who got commission credit. */
  attributedEmployeeId?: number | null;
};

type Quote = { credit: number; sale_number: string; customer_id: number | null };

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
  // Attached customer's store credit (null = no customer / not loaded).
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!cart?.customerId) return;
    fetch(`/api/pos/customers/${cart.customerId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.customer) setCreditBalance(Number(d.customer.store_credit_balance ?? 0));
      })
      .catch(() => undefined);
  }, [cart?.customerId]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Return lines (scanned back on the sell screen) → exact credit from
  // the server, which re-checks every returned tag against the sale.
  const returnLines = (cart?.lines ?? []).filter((l) => l.line_type === "return");
  const returnSaleId = returnLines[0]?.return_ref?.sale_id ?? null;
  const returnItems = returnLines.map((l) => ({
    line_id: l.return_ref!.line_id,
    epc: l.return_ref!.epc,
    quantity: 1,
  }));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  useEffect(() => {
    if (!returnSaleId) return;
    fetch("/api/pos/returns/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sale_id: returnSaleId, items: returnItems }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) setQuote(d as Quote);
        else setQuoteError(d.message ?? "Couldn't price the returned items.");
      })
      .catch(() => setQuoteError("Couldn't price the returned items."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnSaleId]);

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

  // New items vs pieces coming back. Tenders cover only what the return
  // credit doesn't; on an exchange any leftover goes to store credit.
  const newLines = cart.lines.filter((l) => l.line_type !== "return");
  const hasReturns = returnLines.length > 0;
  const saleTotal = hasReturns ? calculateTotals(newLines, cart.taxRate).total : cart.totals.total;
  const credit = quote?.credit ?? 0;
  const total = round2(Math.max(0, saleTotal - credit));
  const toStoreCredit = round2(Math.max(0, credit - saleTotal));
  const returnCustomerId = quote?.customer_id ?? cart.customerId ?? null;
  const cashAmount = round2(Number(cashGiven || 0));

  async function finishSale(payments: Tender[]) {
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
        customer_id: cart.customerId ?? null,
        attributed_employee_id: cart.attributedEmployeeId ?? null,
        lines: captureLines(newLines),
        payments,
        exchange: hasReturns && returnSaleId
          ? { sale_id: returnSaleId, items: returnItems }
          : undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Couldn't finish the sale. Try again.");
      return;
    }
    const data = await res.json();
    // Clear the persisted SellScreen cart so the next sale starts empty.
    try {
      window.localStorage.removeItem(`pos:cart:${code}`);
    } catch {
      /* ignore */
    }
    router.replace(`/sales/${code}/receipt?sale=${data.sale.id}`);
  }

  async function refundOnly(method: "original_card" | "cash" | "store_credit", reason: string) {
    if (!returnSaleId) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/pos/payment/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sale_id: returnSaleId, items: returnItems, method, reason: reason || undefined }),
    });
    setSaving(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? "Couldn't refund. Try again.");
      return;
    }
    try {
      window.localStorage.removeItem(`pos:cart:${code}`);
    } catch {
      /* ignore */
    }
    router.replace(`/sales/${code}/refund/receipt?refund=${d.refund.id}`);
  }

  if (hasReturns && !quote) {
    return (
      <main className="min-h-screen p-4 sm:p-6 max-w-xl mx-auto">
        <button onClick={() => router.back()} className="tap text-[var(--color-pos-muted)] underline px-3 mb-4">
          ← Back to cart
        </button>
        <div className="carbon-card p-6">
          {quoteError ? (
            <p className="text-[var(--color-pos-danger)] font-semibold">{quoteError}</p>
          ) : (
            <p className="text-carbon-text-muted">Checking the returned items…</p>
          )}
        </div>
      </main>
    );
  }

  // Returns only → a refund (the only time money goes back).
  if (hasReturns && newLines.length === 0 && quote) {
    return (
      <RefundCheckout
        amount={quote.credit}
        saleNumber={quote.sale_number}
        pieces={returnLines.length}
        hasCustomer={quote.customer_id != null}
        saving={saving}
        error={error}
        onBack={() => router.back()}
        onRefund={refundOnly}
      />
    );
  }

  // Exchange the returns fully cover: nothing to charge; any leftover
  // goes to the customer's store credit (never money back on exchange).
  if (hasReturns && total === 0 && quote) {
    return (
      <main className="min-h-screen p-4 sm:p-6 max-w-xl mx-auto">
        <button onClick={() => router.back()} className="tap text-[var(--color-pos-muted)] underline px-3 mb-4">
          ← Back to cart
        </button>
        <div className="carbon-card p-6">
          <h1 className="text-2xl font-bold">Complete exchange</h1>
          <p className="text-sm text-carbon-text-muted mt-1">
            {returnLines.length} item{returnLines.length === 1 ? "" : "s"} back from receipt #{quote.sale_number} (tags verified).
          </p>
          <div className="mt-4 space-y-1 text-base">
            <div className="flex justify-between">
              <span>New items</span>
              <span className="tabular-nums">{formatMoney(saleTotal)}</span>
            </div>
            <div className="flex justify-between text-emerald-700 font-semibold">
              <span>Returned items</span>
              <span className="tabular-nums">−{formatMoney(credit)}</span>
            </div>
            <div className="flex justify-between font-bold text-xl border-t border-carbon-border-soft pt-2">
              <span>{toStoreCredit > 0 ? "To customer's store credit" : "Nothing to pay"}</span>
              <span className="tabular-nums">{formatMoney(toStoreCredit)}</span>
            </div>
          </div>
          {toStoreCredit > 0 && !returnCustomerId ? (
            <p className="mt-6 text-[var(--color-pos-danger)] font-semibold">
              An exchange never gives money back — the {formatMoney(toStoreCredit)} difference goes
              to the customer&apos;s store credit. Go back and attach the customer.
            </p>
          ) : (
            <button
              disabled={saving}
              onClick={() => finishSale([])}
              className="carbon-btn-primary tap-lg w-full font-bold mt-6 disabled:opacity-50"
            >
              {saving
                ? "Completing…"
                : toStoreCredit > 0
                  ? `Complete — ${formatMoney(toStoreCredit)} to store credit`
                  : "Complete exchange"}
            </button>
          )}
          {error && <p className="mt-4 text-[var(--color-pos-danger)]">{error}</p>}
        </div>
      </main>
    );
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
          {hasReturns && (
            <p className="text-xs text-emerald-700 font-semibold">
              {formatMoney(saleTotal)} − {formatMoney(credit)} returned items
            </p>
          )}
        </div>
      </header>

      {!splitOn && (
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
      )}

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
          hasCustomer={!!cart?.customerId}
          creditBalance={creditBalance}
          onStoreCredit={() =>
            finishSale([{ method: "store_credit", amount: total }])
          }
          onSplitCredit={() => setSplitOn(true)}
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

      {splitOn ? (
        <div className="mt-2">
          <SplitBuilder
            total={total}
            creditBalance={cart?.customerId ? creditBalance : 0}
            readerId={readerId}
            saving={saving}
            onFinish={(tenders) => finishSale(tenders)}
          />
        </div>
      ) : (
        <div className="mt-5 bg-white border border-[var(--color-pos-border)] rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="font-medium">Split this payment</p>
            <p className="text-xs text-[var(--color-pos-muted)]">
              Combine any mix of card, cash, gift card, account, store
              credit, or check.
            </p>
          </div>
          <button
            onClick={() => setSplitOn(true)}
            className="tap rounded-full px-4 bg-[var(--color-pos-ink)] text-white"
          >
            Start split
          </button>
        </div>
      )}

      {splitOn && (
        <button
          onClick={() => setSplitOn(false)}
          className="tap mt-3 text-sm text-[var(--color-pos-muted)] underline"
        >
          Cancel split — go back to single payment
        </button>
      )}

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
  hasCustomer,
  creditBalance,
  onStoreCredit,
  onSplitCredit,
  onAccount,
  onGiftCard,
}: {
  total: number;
  saving: boolean;
  hasCustomer: boolean;
  creditBalance: number | null;
  onStoreCredit: () => void;
  onSplitCredit: () => void;
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
        {!hasCustomer ? (
          <p className="text-sm text-carbon-text-muted">
            Attach the customer to the sale (back on the cart) to use their
            store credit.
          </p>
        ) : creditBalance === null ? (
          <p className="text-sm text-carbon-text-muted">Loading balance…</p>
        ) : creditBalance + 0.005 >= total ? (
          <>
            <p className="text-sm text-carbon-text-muted mb-3">
              Balance {formatMoney(creditBalance)} — leaves{" "}
              {formatMoney(creditBalance - total)} after this sale.
            </p>
            <button
              type="button"
              disabled={saving}
              onClick={onStoreCredit}
              className="carbon-btn-secondary tap w-full font-semibold disabled:opacity-50"
            >
              Pay {formatMoney(total)} with store credit
            </button>
          </>
        ) : creditBalance > 0 ? (
          <>
            <p className="text-sm text-carbon-text-muted mb-3">
              Balance {formatMoney(creditBalance)} doesn&apos;t cover{" "}
              {formatMoney(total)}. Use it for part and pay the rest another way.
            </p>
            <button
              type="button"
              disabled={saving}
              onClick={onSplitCredit}
              className="carbon-btn-secondary tap w-full font-semibold disabled:opacity-50"
            >
              Split: {formatMoney(creditBalance)} credit + the rest
            </button>
          </>
        ) : (
          <p className="text-sm text-carbon-text-muted">
            This customer has no store credit.
          </p>
        )}
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

function RefundCheckout({
  amount,
  saleNumber,
  pieces,
  hasCustomer,
  saving,
  error,
  onBack,
  onRefund,
}: {
  amount: number;
  saleNumber: string;
  pieces: number;
  hasCustomer: boolean;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onRefund: (method: "original_card" | "cash" | "store_credit", reason: string) => void;
}) {
  const [method, setMethod] = useState<"original_card" | "cash" | "store_credit">("original_card");
  const [reason, setReason] = useState("");
  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-xl mx-auto">
      <button onClick={onBack} className="tap text-[var(--color-pos-muted)] underline px-3 mb-4">
        ← Back to cart
      </button>
      <div className="carbon-card p-6">
        <h1 className="text-2xl font-bold">Refund</h1>
        <p className="text-sm text-carbon-text-muted mt-1">
          {pieces} item{pieces === 1 ? "" : "s"} back from receipt #{saleNumber} — tags verified,
          they go back in stock.
        </p>
        <p className="total-display text-4xl mt-4">{formatMoney(amount)}</p>
        <p className="text-sm font-semibold mt-4 mb-1">Refund to</p>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["original_card", "Original card"],
              ["cash", "Cash"],
              ["store_credit", "Store credit"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              disabled={m === "store_credit" && !hasCustomer}
              className={`tap font-semibold disabled:opacity-40 ${
                method === m ? "bg-[var(--color-pos-ink)] text-white" : "bg-white border border-[var(--color-pos-border)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {!hasCustomer && (
          <p className="text-xs text-carbon-text-muted mt-1">Store credit needs a customer on the original sale.</p>
        )}
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional) — e.g. wrong size"
          className="tap w-full border border-[var(--color-pos-border)] px-3 mt-3"
        />
        <button
          disabled={saving}
          onClick={() => onRefund(method, reason.trim())}
          className="carbon-btn-primary tap-lg w-full font-bold mt-5 disabled:opacity-50"
        >
          {saving ? "Refunding…" : `Refund ${formatMoney(amount)}`}
        </button>
        {error && <p className="mt-4 text-[var(--color-pos-danger)]">{error}</p>}
      </div>
    </main>
  );
}
