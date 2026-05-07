"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { formatMoney } from "@/lib/utils";

type Register = {
  id: number;
  name: string;
  pos_location_id: number;
  location_name: string;
  stripe_reader_label: string | null;
  open_session: {
    id: number;
    opened_by: number;
    opened_at: string;
    opening_cash: string;
  } | null;
};

type CurrentSession = {
  id: number;
  register_id: number;
  register_name: string;
  pos_location_id: number;
  opening_cash: string;
  opened_at: string;
};

export default function RegisterPage() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [registers, setRegisters] = useState<Register[]>([]);
  const [current, setCurrent] = useState<CurrentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerFor, setPickerFor] = useState<Register | null>(null);
  const [closingFor, setClosingFor] = useState<CurrentSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const [a, b] = await Promise.all([
      fetch("/api/pos/registers").then((r) => r.json()),
      fetch("/api/pos/sessions?current=1").then((r) => r.json()),
    ]);
    setRegisters(a.registers ?? []);
    setCurrent(b.session ?? null);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  if (loading) {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <p className="text-[var(--color-pos-muted)]">Loading registers…</p>
      </main>
    );
  }

  // Cashier already has an open session — show "Continue selling" + cash actions.
  if (current) {
    return (
      <SessionDashboard
        session={current}
        onContinue={() => router.push(`/sales/${code}/new`)}
        onClose={() => setClosingFor(current)}
        onRefresh={refresh}
      />
    );
  }

  return (
    <main className="min-h-screen p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Pick your register</h1>
          <p className="text-[var(--color-pos-muted)]">
            Tap your till to start your shift.
          </p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/sign-in" })}
          className="tap text-[var(--color-pos-muted)] underline px-3"
        >
          Sign out
        </button>
      </header>

      {registers.length === 0 ? (
        <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-10 text-center">
          <p className="font-medium mb-2">No registers found.</p>
          <p className="text-[var(--color-pos-muted)]">
            Ask a manager to set one up in the Back Office.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {registers.map((r) => (
            <RegisterCard
              key={r.id}
              register={r}
              onOpen={() => setPickerFor(r)}
              onClose={() => {
                if (!r.open_session) return;
                setClosingFor({
                  id: r.open_session.id,
                  register_id: r.id,
                  register_name: r.name,
                  pos_location_id: r.pos_location_id,
                  opening_cash: r.open_session.opening_cash,
                  opened_at: r.open_session.opened_at,
                });
              }}
            />
          ))}
        </div>
      )}

      {pickerFor && (
        <OpenRegisterModal
          register={pickerFor}
          onCancel={() => setPickerFor(null)}
          onOpened={() => {
            setPickerFor(null);
            router.push(`/sales/${code}/new`);
          }}
          onError={setError}
        />
      )}
      {closingFor && (
        <CloseRegisterModal
          session={closingFor}
          onCancel={() => setClosingFor(null)}
          onClosed={() => {
            setClosingFor(null);
            refresh();
          }}
          onError={setError}
        />
      )}
      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--color-pos-danger)] text-white rounded-xl px-4 py-3 shadow">
          {error}
        </div>
      )}
    </main>
  );
}

function RegisterCard({
  register,
  onOpen,
  onClose,
}: {
  register: Register;
  onOpen: () => void;
  onClose: () => void;
}) {
  const isOpen = !!register.open_session;
  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-5 flex flex-col gap-3">
      <div>
        <p className="text-sm text-[var(--color-pos-muted)]">
          {register.location_name}
        </p>
        <h2 className="text-xl font-semibold">{register.name}</h2>
        {register.stripe_reader_label && (
          <p className="text-xs text-[var(--color-pos-muted)] mt-1">
            Card reader: {register.stripe_reader_label}
          </p>
        )}
      </div>
      {isOpen ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <span className="font-medium">Currently open.</span>{" "}
            <span className="text-[var(--color-pos-muted)]">
              Started with {formatMoney(register.open_session!.opening_cash)} in
              cash.
            </span>
          </p>
          <button
            onClick={onClose}
            className="tap-lg rounded-xl bg-[var(--color-pos-bg)] border border-[var(--color-pos-border)] font-semibold"
          >
            Close This Register
          </button>
        </div>
      ) : (
        <button
          onClick={onOpen}
          className="tap-lg rounded-xl bg-[var(--color-pos-accent)] text-white font-semibold"
        >
          Open This Register
        </button>
      )}
    </div>
  );
}

function OpenRegisterModal({
  register,
  onCancel,
  onOpened,
  onError,
}: {
  register: Register;
  onCancel: () => void;
  onOpened: () => void;
  onError: (m: string) => void;
}) {
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const amount = Number(cash);
    if (!Number.isFinite(amount) || amount < 0) {
      onError("Enter how much cash is in the drawer to start.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pos/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ register_id: register.id, opening_cash: amount }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(data.message ?? "Couldn't open the register. Try again.");
      return;
    }
    onOpened();
  }

  return (
    <Modal title={`Open ${register.name}`} onClose={onCancel}>
      <p className="text-[var(--color-pos-muted)]">
        Count the cash already in the drawer and enter the total below.
      </p>
      <label className="block mt-4 text-sm font-medium">Starting cash</label>
      <input
        type="number"
        inputMode="decimal"
        autoFocus
        step="0.01"
        min="0"
        value={cash}
        onChange={(e) => setCash(e.target.value)}
        className="tap-lg w-full rounded-xl border border-[var(--color-pos-border)] px-4 text-2xl font-semibold mt-1"
        placeholder="0.00"
      />
      <div className="mt-6 flex gap-3">
        <button
          onClick={onCancel}
          className="tap rounded-xl border border-[var(--color-pos-border)] flex-1 font-medium"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="tap rounded-xl bg-[var(--color-pos-accent)] text-white flex-1 font-semibold"
        >
          {busy ? "Opening…" : "Open Register"}
        </button>
      </div>
    </Modal>
  );
}

function CloseRegisterModal({
  session,
  onCancel,
  onClosed,
  onError,
}: {
  session: CurrentSession;
  onCancel: () => void;
  onClosed: () => void;
  onError: (m: string) => void;
}) {
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    expected: number;
    counted: number;
    overShort: number;
  } | null>(null);

  async function submit() {
    const amount = Number(counted);
    if (!Number.isFinite(amount) || amount < 0) {
      onError("Count the cash in the drawer and enter the total.");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/pos/sessions/${session.id}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ closing_cash_counted: amount }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(data.message ?? "Couldn't close the register. Try again.");
      return;
    }
    const data = await res.json();
    setResult({
      expected: Number(data.session.expected_cash),
      counted: Number(data.session.closing_cash_counted),
      overShort: Number(data.session.cash_over_short),
    });
  }

  if (result) {
    const isShort = result.overShort < 0;
    const isOver = result.overShort > 0;
    return (
      <Modal title="Drawer counted" onClose={onClosed}>
        <div className="text-center py-4">
          <p className="text-[var(--color-pos-muted)]">Expected in drawer</p>
          <p className="total-display text-3xl">
            {formatMoney(result.expected)}
          </p>
          <p className="text-[var(--color-pos-muted)] mt-3">You counted</p>
          <p className="total-display text-3xl">
            {formatMoney(result.counted)}
          </p>
          <div
            className={`mt-5 rounded-xl py-3 ${
              result.overShort === 0
                ? "bg-green-50 text-green-800"
                : isShort
                  ? "bg-red-50 text-red-800"
                  : "bg-amber-50 text-amber-800"
            }`}
          >
            {result.overShort === 0
              ? "Spot on! Drawer balances."
              : isShort
                ? `Short by ${formatMoney(Math.abs(result.overShort))}.`
                : `Over by ${formatMoney(result.overShort)}.`}
            {isOver || isShort ? (
              <p className="text-xs mt-1 opacity-80">
                A manager has been notified.
              </p>
            ) : null}
          </div>
          <button
            onClick={onClosed}
            className="tap-lg w-full rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold mt-5"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Close ${session.register_name}`} onClose={onCancel}>
      <p className="text-[var(--color-pos-muted)]">
        Count every bill and coin in the drawer, then enter the total.
      </p>
      <label className="block mt-4 text-sm font-medium">Cash in drawer</label>
      <input
        type="number"
        inputMode="decimal"
        autoFocus
        step="0.01"
        min="0"
        value={counted}
        onChange={(e) => setCounted(e.target.value)}
        className="tap-lg w-full rounded-xl border border-[var(--color-pos-border)] px-4 text-2xl font-semibold mt-1"
        placeholder="0.00"
      />
      <div className="mt-6 flex gap-3">
        <button
          onClick={onCancel}
          className="tap rounded-xl border border-[var(--color-pos-border)] flex-1 font-medium"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="tap rounded-xl bg-[var(--color-pos-ink)] text-white flex-1 font-semibold"
        >
          {busy ? "Closing…" : "Close Register"}
        </button>
      </div>
    </Modal>
  );
}

function SessionDashboard({
  session,
  onContinue,
  onClose,
  onRefresh,
}: {
  session: CurrentSession;
  onContinue: () => void;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [showMovement, setShowMovement] = useState<"drop" | "payout" | null>(
    null,
  );
  return (
    <main className="min-h-screen p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">{session.register_name}</h1>
      <p className="text-[var(--color-pos-muted)]">
        Open since {new Date(session.opened_at).toLocaleString()}. Started with{" "}
        {formatMoney(session.opening_cash)} in cash.
      </p>
      <div className="grid grid-cols-1 gap-3 mt-6">
        <button
          onClick={onContinue}
          className="tap-lg rounded-2xl bg-[var(--color-pos-accent)] text-white text-xl font-semibold"
        >
          Continue Selling
        </button>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setShowMovement("drop")}
            className="tap rounded-xl bg-white border border-[var(--color-pos-border)] font-medium"
          >
            Cash Drop
          </button>
          <button
            onClick={() => setShowMovement("payout")}
            className="tap rounded-xl bg-white border border-[var(--color-pos-border)] font-medium"
          >
            Cash Payout
          </button>
        </div>
        <button
          onClick={onClose}
          className="tap rounded-xl bg-white border border-[var(--color-pos-border)] font-medium"
        >
          Close Register
        </button>
      </div>
      {showMovement && (
        <CashMovementModal
          sessionId={session.id}
          type={showMovement}
          onCancel={() => setShowMovement(null)}
          onDone={() => {
            setShowMovement(null);
            onRefresh();
          }}
        />
      )}
    </main>
  );
}

function CashMovementModal({
  sessionId,
  type,
  onCancel,
  onDone,
}: {
  sessionId: number;
  type: "drop" | "payout";
  onCancel: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    const res = await fetch(
      `/api/pos/sessions/${sessionId}/cash-movement`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, amount: n, reason }),
      },
    );
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Couldn't record that. Try again.");
      return;
    }
    onDone();
  }

  return (
    <Modal
      title={type === "drop" ? "Cash Drop" : "Cash Payout"}
      onClose={onCancel}
    >
      <p className="text-[var(--color-pos-muted)]">
        {type === "drop"
          ? "Cash leaving the drawer for the safe or bank deposit."
          : "Cash leaving the drawer for petty cash, refund, etc."}
      </p>
      <label className="block mt-4 text-sm font-medium">Amount</label>
      <input
        type="number"
        inputMode="decimal"
        autoFocus
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="tap-lg w-full rounded-xl border border-[var(--color-pos-border)] px-4 text-2xl font-semibold mt-1"
      />
      <label className="block mt-4 text-sm font-medium">Reason</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="tap w-full rounded-lg border border-[var(--color-pos-border)] px-3 mt-1"
        placeholder={
          type === "drop" ? "e.g. Mid-day deposit" : "e.g. Office supplies"
        }
      />
      {error && (
        <p className="text-sm text-[var(--color-pos-danger)] mt-2">{error}</p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={onCancel}
          className="tap rounded-xl border border-[var(--color-pos-border)] flex-1 font-medium"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="tap rounded-xl bg-[var(--color-pos-ink)] text-white flex-1 font-semibold"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-md rounded-2xl p-6 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="text-[var(--color-pos-muted)] text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
