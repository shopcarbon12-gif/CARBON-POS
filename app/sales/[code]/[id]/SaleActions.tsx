"use client";

import { useState } from "react";

/**
 * Re-print + email receipt controls for the sale detail page. The server
 * endpoints already exist (/api/pos/sales/[id]/print and /email); this is
 * just the manager-facing UI on the sale detail screen.
 */
export function SaleActions({
  saleId,
  defaultEmail,
}: {
  saleId: number;
  defaultEmail?: string | null;
}) {
  const [printState, setPrintState] = useState<
    "idle" | "printing" | "done" | "error"
  >("idle");
  const [emailValue, setEmailValue] = useState(defaultEmail ?? "");
  const [emailState, setEmailState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function reprint() {
    setPrintState("printing");
    setMsg(null);
    try {
      const res = await fetch(`/api/pos/sales/${saleId}/print`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPrintState("error");
        setMsg(data.message ?? "Couldn't reach the printer.");
        return;
      }
      if (data.skipped) {
        setPrintState("error");
        setMsg(
          "No receipt printer is configured for this location. Set it in Settings → Locations.",
        );
        return;
      }
      setPrintState("done");
      setMsg("Sent to printer.");
    } catch {
      setPrintState("error");
      setMsg("Couldn't reach the printer.");
    }
  }

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
        <button
          type="button"
          onClick={reprint}
          disabled={printState === "printing"}
          className="w-full px-4 py-2 rounded-xl bg-[var(--color-pos-accent)] text-white font-medium disabled:opacity-60"
        >
          {printState === "printing" ? "Printing…" : "Re-print receipt"}
        </button>
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
              printState === "error" || emailState === "error"
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
