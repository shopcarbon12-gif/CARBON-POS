"use client";

import { useState } from "react";
import { formatMoney, round2 } from "@/lib/utils";
import { CashKeypad } from "@/components/pos/CashKeypad";
import { PaymentModal } from "@/components/pos/PaymentModal";

export type Tender =
  | {
      method: "card";
      amount: number;
      payment_intent_id: string;
      reader_id: string | null;
      brand?: string | null;
    }
  | { method: "cash"; amount: number; cash_given: number }
  | { method: "check"; amount: number; check_number: string }
  | { method: "store_credit"; amount: number }
  | { method: "account"; amount: number; reference: string | null }
  | { method: "gift_card"; amount: number; gift_card_number: string };

type AddMode =
  | null
  | "card"
  | "cash"
  | "gift_card"
  | "account"
  | "store_credit"
  | "check";

/**
 * Flexible split-tender builder. Lets the cashier stack any number of
 * payment methods until the running tally equals the sale total.
 *
 * Cards are routed through the real Stripe Terminal pinpad — one
 * PaymentIntent per card tender. The capture endpoint already loops
 * intents and captures each, so split-card across two physical cards is
 * supported end-to-end. Removing a card tender from the list cancels its
 * uncaptured intent so we don't leave a hold on the customer's card.
 */
export function SplitBuilder({
  total,
  readerId,
  saving,
  onFinish,
}: {
  total: number;
  readerId: string | null;
  saving: boolean;
  onFinish: (tenders: Tender[]) => void;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [addMode, setAddMode] = useState<AddMode>(null);

  const paid = round2(tenders.reduce((s, t) => s + t.amount, 0));
  const remaining = round2(Math.max(0, total - paid));
  const ready = Math.abs(paid - total) < 0.01 && tenders.length > 0;

  function addTender(t: Tender) {
    setTenders((prev) => [...prev, t]);
    setAddMode(null);
  }

  async function removeTender(idx: number) {
    const t = tenders[idx];
    if (!t) return;
    if (t.method === "card") {
      // Release the uncaptured auth on Stripe's side so the customer's
      // bank drops the hold. Best-effort — we still remove locally even
      // if Stripe rejects (e.g. already canceled).
      try {
        await fetch("/api/pos/payment/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payment_intent_id: t.payment_intent_id }),
        });
      } catch {
        /* best-effort */
      }
    }
    setTenders((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <span className="font-semibold text-lg">Split payment</span>
        <span className="text-[var(--color-pos-muted)] text-sm">
          {tenders.length === 0
            ? "Add tenders until the balance hits zero."
            : `Paid ${formatMoney(paid)} of ${formatMoney(total)}`}
        </span>
      </div>

      {tenders.length > 0 && (
        <ul className="mb-3 divide-y divide-[var(--color-pos-border)]">
          {tenders.map((t, i) => (
            <li key={i} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <p className="font-medium">{tenderLabel(t)}</p>
                <p className="text-xs text-[var(--color-pos-muted)] truncate">
                  {tenderDetail(t)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="tabular-nums font-semibold">
                  {formatMoney(t.amount)}
                </span>
                <button
                  type="button"
                  onClick={() => removeTender(i)}
                  className="tap rounded-lg border border-[var(--color-pos-border)] text-sm px-2"
                  aria-label="Remove tender"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
        <span className="text-[var(--color-pos-muted)]">Remaining</span>
        <span
          className={`text-right total-display text-2xl ${
            remaining > 0 ? "" : "text-[var(--color-pos-accent-2)]"
          }`}
        >
          {formatMoney(remaining)}
        </span>
      </div>

      {addMode === null && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <AddButton label="Card" onClick={() => setAddMode("card")} />
            <AddButton label="Cash" onClick={() => setAddMode("cash")} />
            <AddButton
              label="Gift Card"
              onClick={() => setAddMode("gift_card")}
            />
            <AddButton label="Account" onClick={() => setAddMode("account")} />
            <AddButton
              label="Store Credit"
              onClick={() => setAddMode("store_credit")}
            />
            <AddButton label="Check" onClick={() => setAddMode("check")} />
          </div>
          <button
            type="button"
            disabled={!ready || saving}
            onClick={() => onFinish(tenders)}
            className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent-2)] text-white text-xl font-semibold disabled:opacity-50"
          >
            {saving
              ? "Saving…"
              : ready
                ? "Finish Sale"
                : remaining > 0
                  ? `Add ${formatMoney(remaining)} more`
                  : "Add at least one tender"}
          </button>
        </>
      )}

      {addMode === "card" && (
        <AddCard
          remaining={remaining}
          readerId={readerId}
          onAdd={addTender}
          onCancel={() => setAddMode(null)}
        />
      )}
      {addMode === "cash" && (
        <AddCash
          remaining={remaining}
          onAdd={addTender}
          onCancel={() => setAddMode(null)}
        />
      )}
      {addMode === "gift_card" && (
        <AddGiftCard
          remaining={remaining}
          onAdd={addTender}
          onCancel={() => setAddMode(null)}
        />
      )}
      {addMode === "account" && (
        <AddAccount
          remaining={remaining}
          onAdd={addTender}
          onCancel={() => setAddMode(null)}
        />
      )}
      {addMode === "store_credit" && (
        <AddStoreCredit
          remaining={remaining}
          onAdd={addTender}
          onCancel={() => setAddMode(null)}
        />
      )}
      {addMode === "check" && (
        <AddCheck
          remaining={remaining}
          onAdd={addTender}
          onCancel={() => setAddMode(null)}
        />
      )}
    </div>
  );
}

function AddButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap rounded-xl bg-white border border-[var(--color-pos-border)] font-semibold"
    >
      {label}
    </button>
  );
}

function tenderLabel(t: Tender): string {
  switch (t.method) {
    case "card":
      return "Card";
    case "cash":
      return "Cash";
    case "check":
      return "Check";
    case "store_credit":
      return "Store Credit";
    case "account":
      return "Account";
    case "gift_card":
      return "Gift Card";
  }
}

function tenderDetail(t: Tender): string {
  switch (t.method) {
    case "card":
      return `intent ${t.payment_intent_id.slice(-6)}`;
    case "cash":
      return `Given ${formatMoney(t.cash_given)} · Change ${formatMoney(
        Math.max(0, round2(t.cash_given - t.amount)),
      )}`;
    case "check":
      return `Check #${t.check_number}`;
    case "store_credit":
      return "Customer store credit balance";
    case "account":
      return t.reference ? `Ref ${t.reference}` : "House account";
    case "gift_card":
      return `Card ${t.gift_card_number}`;
  }
}

function PartialFrame({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-[var(--color-pos-border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold">{title}</span>
        <button
          type="button"
          onClick={onCancel}
          className="tap text-sm text-[var(--color-pos-muted)] underline"
        >
          Back
        </button>
      </div>
      {children}
    </div>
  );
}

function AmountInput({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  max: number;
}) {
  return (
    <label className="block text-sm font-medium mb-3">
      Amount on this tender
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-3 mt-1 text-lg"
      />
      <span className="text-xs text-[var(--color-pos-muted)]">
        Max for this tender: {formatMoney(max)}
      </span>
    </label>
  );
}

function AddCard({
  remaining,
  readerId,
  onAdd,
  onCancel,
}: {
  remaining: number;
  readerId: string | null;
  onAdd: (t: Tender) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const amt = round2(Number(amount || 0));
  const ok = amt > 0 && amt <= remaining + 0.001;
  const [confirmed, setConfirmed] = useState(false);

  return (
    <PartialFrame title="Card on pinpad" onCancel={onCancel}>
      {!confirmed ? (
        <>
          <AmountInput value={amount} onChange={setAmount} max={remaining} />
          <button
            type="button"
            disabled={!ok}
            onClick={() => setConfirmed(true)}
            className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent)] text-white text-lg font-semibold disabled:opacity-50"
          >
            Charge {formatMoney(amt)} on reader
          </button>
        </>
      ) : (
        <PaymentModal
          amount={amt}
          readerId={readerId}
          saving={false}
          onCancel={onCancel}
          onApprove={(intentId) =>
            onAdd({
              method: "card",
              amount: amt,
              payment_intent_id: intentId,
              reader_id: readerId,
            })
          }
        />
      )}
    </PartialFrame>
  );
}

function AddCash({
  remaining,
  onAdd,
  onCancel,
}: {
  remaining: number;
  onAdd: (t: Tender) => void;
  onCancel: () => void;
}) {
  const [given, setGiven] = useState(remaining.toFixed(2));
  const cashGiven = round2(Number(given || 0));
  // Cash applied to this tender is capped at the remaining balance —
  // anything above that is change handed back to the customer.
  const applied = Math.min(remaining, cashGiven);
  const ok = applied > 0;
  return (
    <PartialFrame title="Cash" onCancel={onCancel}>
      <CashKeypad value={given} onChange={setGiven} total={remaining} />
      <button
        type="button"
        disabled={!ok}
        onClick={() =>
          onAdd({
            method: "cash",
            amount: round2(applied),
            cash_given: cashGiven,
          })
        }
        className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent-2)] text-white text-lg font-semibold disabled:opacity-50 mt-3"
      >
        Apply {formatMoney(applied)} cash
      </button>
    </PartialFrame>
  );
}

function AddGiftCard({
  remaining,
  onAdd,
  onCancel,
}: {
  remaining: number;
  onAdd: (t: Tender) => void;
  onCancel: () => void;
}) {
  const [num, setNum] = useState("");
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const amt = round2(Number(amount || 0));
  const ok = num.trim().length > 0 && amt > 0 && amt <= remaining + 0.001;
  return (
    <PartialFrame title="Gift card" onCancel={onCancel}>
      <label className="block text-sm font-medium mb-3">
        Gift card number / serial
        <input
          type="text"
          value={num}
          onChange={(e) => setNum(e.target.value)}
          className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-3 mt-1"
          placeholder="Printed on the back"
          autoFocus
        />
      </label>
      <AmountInput value={amount} onChange={setAmount} max={remaining} />
      <button
        type="button"
        disabled={!ok}
        onClick={() =>
          onAdd({
            method: "gift_card",
            amount: amt,
            gift_card_number: num.trim(),
          })
        }
        className="tap-lg w-full rounded-2xl bg-[var(--color-pos-ink)] text-white text-lg font-semibold disabled:opacity-50"
      >
        Apply {formatMoney(amt)}
      </button>
    </PartialFrame>
  );
}

function AddAccount({
  remaining,
  onAdd,
  onCancel,
}: {
  remaining: number;
  onAdd: (t: Tender) => void;
  onCancel: () => void;
}) {
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const amt = round2(Number(amount || 0));
  const ok = amt > 0 && amt <= remaining + 0.001;
  return (
    <PartialFrame title="Charge to account" onCancel={onCancel}>
      <label className="block text-sm font-medium mb-3">
        Reference (optional)
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-3 mt-1"
          placeholder="PO number, note"
        />
      </label>
      <AmountInput value={amount} onChange={setAmount} max={remaining} />
      <button
        type="button"
        disabled={!ok}
        onClick={() =>
          onAdd({
            method: "account",
            amount: amt,
            reference: ref.trim() || null,
          })
        }
        className="tap-lg w-full rounded-2xl bg-[var(--color-pos-ink)] text-white text-lg font-semibold disabled:opacity-50"
      >
        Apply {formatMoney(amt)}
      </button>
    </PartialFrame>
  );
}

function AddStoreCredit({
  remaining,
  onAdd,
  onCancel,
}: {
  remaining: number;
  onAdd: (t: Tender) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const amt = round2(Number(amount || 0));
  const ok = amt > 0 && amt <= remaining + 0.001;
  return (
    <PartialFrame title="Store credit" onCancel={onCancel}>
      <AmountInput value={amount} onChange={setAmount} max={remaining} />
      <button
        type="button"
        disabled={!ok}
        onClick={() => onAdd({ method: "store_credit", amount: amt })}
        className="tap-lg w-full rounded-2xl bg-[var(--color-pos-ink)] text-white text-lg font-semibold disabled:opacity-50"
      >
        Apply {formatMoney(amt)}
      </button>
    </PartialFrame>
  );
}

function AddCheck({
  remaining,
  onAdd,
  onCancel,
}: {
  remaining: number;
  onAdd: (t: Tender) => void;
  onCancel: () => void;
}) {
  const [num, setNum] = useState("");
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const amt = round2(Number(amount || 0));
  const ok = num.trim().length > 0 && amt > 0 && amt <= remaining + 0.001;
  return (
    <PartialFrame title="Check" onCancel={onCancel}>
      <label className="block text-sm font-medium mb-3">
        Check number
        <input
          type="text"
          value={num}
          onChange={(e) => setNum(e.target.value)}
          className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-3 mt-1"
          autoFocus
        />
      </label>
      <AmountInput value={amount} onChange={setAmount} max={remaining} />
      <button
        type="button"
        disabled={!ok}
        onClick={() =>
          onAdd({ method: "check", amount: amt, check_number: num.trim() })
        }
        className="tap-lg w-full rounded-2xl bg-[var(--color-pos-ink)] text-white text-lg font-semibold disabled:opacity-50"
      >
        Apply {formatMoney(amt)}
      </button>
    </PartialFrame>
  );
}
