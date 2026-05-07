"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type MovementType = "drop" | "payout" | "add";

/**
 * Client-side wrapper around the four "Current register" buttons. Owns the
 * modal state for cash drop / payout / add. "Switch Register" is disabled
 * when there is only one register at this location — the picker hooks in
 * automatically once a second register exists (registerCount >= 2).
 */
export function RegisterActionsClient({
  code,
  sessionId,
  registerCount,
}: {
  code: string;
  sessionId: number;
  registerCount: number;
}) {
  const router = useRouter();
  const [openMovement, setOpenMovement] = useState<MovementType | "menu" | null>(
    null,
  );

  const canSwitch = registerCount >= 2;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ActionButton
          onClick={() => {
            if (!canSwitch) return;
            // Future: open switch-register picker. Disabled today.
          }}
          disabled={!canSwitch}
          title={
            canSwitch
              ? "Switch to another register at this location"
              : "Only one register at this location."
          }
          label="Switch Register"
          icon="swap_horizontal_circle"
        />
        <ActionButtonLink
          href={`/sales/${code}/register/close`}
          label="Close Register"
          icon="logout"
        />
        <ActionButton
          onClick={() => setOpenMovement("menu")}
          label="Payout / Drop"
          icon="payments"
        />
        <ActionButton
          onClick={() => setOpenMovement("add")}
          label="Add Amount"
          icon="add_card"
        />
      </div>

      {openMovement === "menu" ? (
        <PayoutDropPicker
          onCancel={() => setOpenMovement(null)}
          onPick={(t) => setOpenMovement(t)}
        />
      ) : null}

      {openMovement === "drop" || openMovement === "payout" || openMovement === "add" ? (
        <CashMovementModal
          sessionId={sessionId}
          type={openMovement}
          onCancel={() => setOpenMovement(null)}
          onDone={() => {
            setOpenMovement(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function ActionButton({
  onClick,
  label,
  icon,
  disabled,
  title,
}: {
  onClick: () => void;
  label: string;
  icon: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`tap-lg flex items-center justify-center gap-2 px-4 carbon-btn-secondary ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <span className="material-symbols-outlined">{icon}</span>
      <span className="font-semibold">{label}</span>
    </button>
  );
}

function ActionButtonLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: string;
}) {
  return (
    <a
      href={href}
      className="tap-lg flex items-center justify-center gap-2 px-4 carbon-btn-secondary"
    >
      <span className="material-symbols-outlined">{icon}</span>
      <span className="font-semibold">{label}</span>
    </a>
  );
}

function PayoutDropPicker({
  onCancel,
  onPick,
}: {
  onCancel: () => void;
  onPick: (t: "drop" | "payout") => void;
}) {
  return (
    <Modal title="Cash out of drawer" onClose={onCancel}>
      <p className="text-sm text-carbon-text-muted">
        Pick what kind of cash movement this is.
      </p>
      <div className="grid grid-cols-1 gap-3 mt-4">
        <button
          type="button"
          onClick={() => onPick("drop")}
          className="tap-lg flex items-start gap-3 px-4 py-3 carbon-btn-secondary text-left"
        >
          <span className="material-symbols-outlined text-carbon-blue mt-0.5">
            account_balance
          </span>
          <span>
            <span className="block font-semibold text-base text-carbon-text">
              Cash Drop
            </span>
            <span className="block text-sm text-carbon-text-muted">
              Cash leaving the drawer for the safe or bank deposit.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onPick("payout")}
          className="tap-lg flex items-start gap-3 px-4 py-3 carbon-btn-secondary text-left"
        >
          <span className="material-symbols-outlined text-carbon-blue mt-0.5">
            local_atm
          </span>
          <span>
            <span className="block font-semibold text-base text-carbon-text">
              Cash Payout
            </span>
            <span className="block text-sm text-carbon-text-muted">
              Cash leaving the drawer for petty cash, refunds, etc.
            </span>
          </span>
        </button>
      </div>
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="carbon-btn-secondary tap px-5 font-semibold"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function CashMovementModal({
  sessionId,
  type,
  onCancel,
  onDone,
}: {
  sessionId: number;
  type: MovementType;
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
    setError(null);
    const res = await fetch(`/api/pos/sessions/${sessionId}/cash-movement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, amount: n, reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Couldn't record that. Try again.");
      return;
    }
    // Best-effort audit slip + drawer kick. Both can fail (no printer in
    // dev) without blocking the cashier — the movement is already saved.
    const data = (await res.json().catch(() => ({}))) as {
      movement?: { id: number };
    };
    if (data.movement?.id) {
      void fetch(`/api/pos/cash-movements/${data.movement.id}/print`, {
        method: "POST",
      }).catch(() => undefined);
    }
    onDone();
  }

  const config = {
    drop: {
      title: "Cash Drop",
      blurb: "Cash leaving the drawer for the safe or bank deposit.",
      placeholder: "e.g. Mid-day deposit",
      cta: "Save Drop",
    },
    payout: {
      title: "Cash Payout",
      blurb: "Cash leaving the drawer for petty cash, refund, etc.",
      placeholder: "e.g. Office supplies",
      cta: "Save Payout",
    },
    add: {
      title: "Add Amount",
      blurb: "Cash being added to the drawer (e.g. extra change from the safe).",
      placeholder: "e.g. Change for tens",
      cta: "Save Add",
    },
  }[type];

  return (
    <Modal title={config.title} onClose={onCancel}>
      <p className="text-sm text-carbon-text-muted">{config.blurb}</p>
      <label className="block mt-4 text-sm font-semibold text-carbon-text">
        Amount
      </label>
      <input
        type="number"
        inputMode="decimal"
        autoFocus
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        className="carbon-input tap-lg w-full px-4 text-2xl font-bold mt-1"
      />
      <label className="block mt-4 text-sm font-semibold text-carbon-text">
        Reason
      </label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={config.placeholder}
        className="carbon-input tap w-full px-3 mt-1 text-base"
      />
      {error ? (
        <p className="text-sm text-carbon-danger mt-3">{error}</p>
      ) : null}
      <div className="mt-6 flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="carbon-btn-secondary tap px-5 font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="carbon-btn-primary tap px-5 font-semibold disabled:opacity-50"
        >
          {busy ? "Saving…" : config.cta}
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
    <div className="fixed inset-0 bg-black/55 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-md p-6 shadow-lg border border-carbon-border-soft">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-carbon-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-carbon-text-muted hover:text-carbon-text text-2xl leading-none px-2"
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
