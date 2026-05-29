"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Store-credit adjuster. The approver (super admin) adjusts directly. Everyone
 * else goes through an email-token approval: enter the amount, request a code
 * (emailed to the approver), then enter that code to apply the exact approved
 * amount. `isApprover` is decided server-side from the signed-in email.
 */
export function StoreCreditAdjuster({
  customerId,
  isApprover,
}: {
  customerId: number;
  isApprover: boolean;
}) {
  const router = useRouter();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Approval flow state (non-approver only).
  const [stage, setStage] = useState<"enter" | "verify">("enter");
  const [approvalId, setApprovalId] = useState<number | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<string | null>(null);

  const base = `/api/pos/customers/${customerId}/store-credit`;

  function reset() {
    setDelta("");
    setReason("");
    setCode("");
    setApprovalId(null);
    setSentTo(null);
    setStage("enter");
    setError(null);
    setInfo(null);
  }

  // --- Approver path: direct apply ---------------------------------------
  async function applyDirect() {
    const n = Number(delta);
    if (!Number.isFinite(n) || n === 0) {
      setError("Enter a non-zero amount. Use a minus sign to deduct.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delta: n, reason: reason || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't adjust the balance.");
      return;
    }
    reset();
    router.refresh();
  }

  // --- Non-approver path: request code -----------------------------------
  async function requestCode() {
    const n = Number(delta);
    if (!Number.isFinite(n) || n === 0) {
      setError("Enter a non-zero amount. Use a minus sign to deduct.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`${base}/request-approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delta: n, reason: reason || undefined }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? "Couldn't request approval.");
      return;
    }
    setApprovalId(d.approval_id);
    setSentTo(d.sent_to ?? null);
    setStage("verify");
    setInfo(
      `A ${formatDelta(n)} approval code was emailed to ${d.sent_to ?? "the approver"}. Enter it below to apply.`,
    );
  }

  // --- Non-approver path: submit code ------------------------------------
  async function applyWithCode() {
    if (!approvalId || !/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the approval email.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, code }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't apply the adjustment.");
      // Expired / used / locked → force a fresh request.
      if (["approval_expired", "approval_used", "approval_locked", "approval_not_found"].includes(d.error)) {
        setStage("enter");
        setApprovalId(null);
        setCode("");
        setInfo(null);
      }
      return;
    }
    reset();
    router.refresh();
  }

  const inputCls =
    "carbon-input tap w-full mt-1";
  const btnCls =
    "carbon-btn-primary tap w-full font-semibold mt-2 inline-flex items-center justify-center";

  return (
    <div className="mt-3">
      {isApprover ? (
        <>
          <label className="text-xs font-medium text-[var(--color-pos-muted)]">
            Adjust balance (use minus to deduct)
          </label>
          <input
            type="number"
            step="0.01"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            className={inputCls}
          />
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className={`${inputCls} mt-2`}
          />
          <button onClick={applyDirect} disabled={busy} className={btnCls}>
            {busy ? "Saving…" : "Apply"}
          </button>
        </>
      ) : stage === "enter" ? (
        <>
          <label className="text-xs font-medium text-[var(--color-pos-muted)]">
            Adjust balance (use minus to deduct) — needs approval
          </label>
          <input
            type="number"
            step="0.01"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            className={inputCls}
          />
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className={`${inputCls} mt-2`}
          />
          <button onClick={requestCode} disabled={busy} className={btnCls}>
            {busy ? "Sending…" : "Request approval code"}
          </button>
          <p className="text-xs text-[var(--color-pos-muted)] mt-2">
            A one-time code is emailed to the store-credit approver. You can only
            apply the exact amount they approve.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">
            Approve {formatDelta(Number(delta))}
          </p>
          {info && (
            <p className="text-xs text-[var(--color-pos-muted)] mt-1">{info}</p>
          )}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="6-digit code"
            className={`${inputCls} tracking-[0.4em] text-center text-lg`}
          />
          <button onClick={applyWithCode} disabled={busy} className={btnCls}>
            {busy ? "Applying…" : "Approve & apply"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-carbon-blue hover:underline mt-2"
          >
            Cancel / start over
          </button>
        </>
      )}
      {error && (
        <p className="text-xs text-[var(--color-pos-danger)] mt-2">{error}</p>
      )}
    </div>
  );
}

function formatDelta(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "an adjustment";
  const amt = Math.abs(n).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
  return n >= 0 ? `a grant of ${amt}` : `a deduction of ${amt}`;
}
