"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Re-print + email receipt controls for the sale detail page. Re-print
 * opens the receipt preview page (where the cashier can review the
 * customer + merchant copies and then trigger the print) rather than
 * firing the printer silently. Email uses /api/pos/sales/[id]/email
 * directly since there's no preview to show for that flow.
 */
export function SaleActions({
  saleId,
  code,
  defaultEmail,
}: {
  saleId: number;
  code: string;
  defaultEmail?: string | null;
}) {
  const [emailValue, setEmailValue] = useState(defaultEmail ?? "");
  const [emailState, setEmailState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function sendEmail() {
    const to = emailValue.trim();
    if (!to) return;
    setEmailState("sending");
    setMsg(null);
    try {
      const res = await fetch(`/api/pos/sales/${saleId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailState("error");
        setMsg(data.message ?? "Couldn't send the email.");
        return;
      }
      setEmailState("done");
      setMsg(`Receipt emailed to ${to}.`);
    } catch {
      setEmailState("error");
      setMsg("Couldn't send the email.");
    }
  }

  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
      <h2 className="font-semibold mb-3">Receipt</h2>
      <div className="flex flex-col gap-3">
        <Link
          href={`/sales/${code}/receipt?sale=${saleId}`}
          className="w-full px-4 py-2 rounded-xl bg-[var(--color-pos-accent)] text-white font-medium text-center"
        >
          Re-print receipt
        </Link>
        <div className="flex gap-2">
          <input
            type="email"
            value={emailValue}
            onChange={(e) => setEmailValue(e.target.value)}
            placeholder="customer@example.com"
            className="flex-1 px-3 py-2 rounded-xl border border-[var(--color-pos-border)] text-sm"
          />
          <button
            type="button"
            onClick={sendEmail}
            disabled={emailState === "sending" || !emailValue.trim()}
            className="px-4 py-2 rounded-xl border border-[var(--color-pos-border)] font-medium disabled:opacity-60"
          >
            {emailState === "sending" ? "Sending…" : "Email"}
          </button>
        </div>
        {msg && (
          <p
            className={`text-xs ${
              emailState === "error"
                ? "text-red-700"
                : "text-[var(--color-pos-muted)]"
            }`}
          >
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
