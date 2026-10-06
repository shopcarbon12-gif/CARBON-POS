"use client";

import { useEffect, useState } from "react";

export type OverrideKind = "rfid_sale" | "rfid_return" | "exchange_payout";

/**
 * Admin approval for an override. Two ways:
 *   • an admin types their PIN here (an admin ringing the sale is
 *     approved straight away), or
 *   • "Email code" sends Elior a one-time 6-digit code describing this
 *     request; he gives it to the employee, who types it here.
 * Resolves with a signed token the cart carries to checkout.
 */
export function OverrideModal({
  kind,
  refId,
  title,
  detail,
  onApproved,
  onCancel,
}: {
  kind: OverrideKind;
  /** SKU id (rfid_sale) or original sale id (rfid_return / exchange_payout). */
  refId: string;
  title: string;
  /** What's being approved — shown here and in the email. */
  detail: string;
  onApproved: (token: string, approver: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"pin" | "email">("pin");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [requestId, setRequestId] = useState<number | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/pos/overrides/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ref: refId, ...body }),
    }).catch(() => null);
    setBusy(false);
    const d = (await r?.json().catch(() => ({}))) as {
      token?: string;
      approver?: string;
      error?: string;
      message?: string;
    };
    if (r?.ok && d.token) {
      onApproved(d.token, d.approver ?? "admin");
      return true;
    }
    if (d?.error !== "approval_required") setError(d?.message ?? "Couldn't approve.");
    return false;
  }

  // An admin ringing the sale is approved without a PIN.
  useEffect(() => {
    void approve({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendCode() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/pos/overrides/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ref: refId, detail }),
    }).catch(() => null);
    setBusy(false);
    const d = (await r?.json().catch(() => ({}))) as { request_id?: number; sent_to?: string; message?: string };
    if (r?.ok && d.request_id) {
      setRequestId(d.request_id);
      setSentTo(d.sent_to ?? null);
    } else {
      setError(d?.message ?? "Couldn't send the code.");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600 text-3xl" aria-hidden>
            admin_panel_settings
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{title}</h2>
            <p className="text-sm text-carbon-text-muted mt-1">{detail}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            onClick={() => setMode("pin")}
            className={`tap font-semibold ${mode === "pin" ? "carbon-btn-primary" : "border border-carbon-border"}`}
          >
            Admin PIN
          </button>
          <button
            onClick={() => setMode("email")}
            className={`tap font-semibold ${mode === "email" ? "carbon-btn-primary" : "border border-carbon-border"}`}
          >
            Email code to Elior
          </button>
        </div>
        {mode === "pin" ? (
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            placeholder="Admin PIN"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(v);
              if (v.length === 4) void approve({ pin: v }).then((ok) => !ok && setPin(""));
            }}
            className="tap-lg w-full border border-carbon-border px-3 text-3xl tracking-[0.5em] text-center mt-4"
          />
        ) : requestId === null ? (
          <div className="mt-4">
            <p className="text-sm text-carbon-text-muted mb-3">
              Sends Elior an email describing this request with a one-time code. If he
              approves, he&apos;ll give you the code.
            </p>
            <button
              onClick={() => void sendCode()}
              disabled={busy}
              className="tap w-full carbon-btn-primary font-semibold disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send approval request"}
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-emerald-700 mb-2">
              Request sent{sentTo ? ` to ${sentTo}` : ""}. Enter the 6-digit code (valid 15 minutes).
            </p>
            <input
              autoFocus
              inputMode="numeric"
              maxLength={6}
              value={code}
              placeholder="••••••"
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) void approve({ request_id: requestId, code: v }).then((ok) => !ok && setCode(""));
              }}
              className="tap-lg w-full border border-carbon-border px-3 text-3xl tracking-[0.4em] text-center"
            />
            <button onClick={() => void sendCode()} disabled={busy} className="text-sm underline mt-2 text-carbon-text-muted">
              Send a new code
            </button>
          </div>
        )}
        {busy && mode === "pin" && <p className="text-xs mt-2">Checking…</p>}
        {error && <p className="text-sm text-[var(--color-pos-danger)] mt-3">{error}</p>}
        <button onClick={onCancel} className="tap w-full border border-carbon-border font-medium mt-4">
          Cancel
        </button>
      </div>
    </div>
  );
}
