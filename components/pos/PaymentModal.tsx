"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";

/**
 * In-page card-payment "modal". Renders the full server-driven Stripe
 * Terminal flow: send-to-reader → wait → finish. Used by /pos/payment when
 * the cashier picks Card.
 *
 * The HTTP wiring is:
 *   POST /api/pos/payment/create-intent → { id, client_secret }
 *   POST /api/pos/payment/process       → tells the reader to collect
 *   poll  /api/pos/payment/intent-status?id=… until status='requires_capture'
 *   then call onApprove(intent_id) which the parent uses to finalize the
 *   sale via /api/pos/payment/capture.
 *
 * If the register has no paired stripe_reader_id (e.g. tests, pre-launch),
 * we render a "Mark approved" button so the rest of the flow is testable
 * without the hardware.
 */
export function PaymentModal({
  amount,
  readerId,
  onApprove,
  onCancel,
  saving,
}: {
  amount: number;
  readerId: string | null;
  onApprove: (intentId: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [status, setStatus] = useState<
    "idle" | "creating" | "sending" | "waiting" | "approved" | "declined" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function start() {
    setStatus("creating");
    setMessage("Setting up the card payment…");
    try {
      const res = await fetch("/api/pos/payment/create-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, description: "Carbon POS sale" }),
      });
      if (!res.ok) throw new Error("create_intent_failed");
      const data = await res.json();
      setIntentId(data.id);

      if (!readerId) {
        // No physical reader paired — operator can mark approved manually.
        setStatus("waiting");
        setMessage(
          "No card reader is paired with this register. Pair one in Settings, or tap below to mark this card payment approved (test mode).",
        );
        return;
      }

      setStatus("sending");
      setMessage("Sending the amount to the reader…");
      const send = await fetch("/api/pos/payment/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reader_id: readerId, payment_intent_id: data.id }),
      });
      if (!send.ok) {
        const e = await send.json().catch(() => ({}));
        throw new Error(e.message ?? "reader_unavailable");
      }
      setStatus("waiting");
      setMessage(
        "Hand the reader to the customer. Waiting for them to tap or insert their card…",
      );

      // Poll Stripe-side intent status until it's ready for capture.
      pollRef.current = setInterval(async () => {
        try {
          const check = await fetch(
            `/api/pos/payment/intent-status?id=${encodeURIComponent(data.id)}`,
          );
          if (!check.ok) return;
          const c = await check.json();
          if (c.status === "requires_capture" || c.status === "succeeded") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStatus("approved");
            setMessage("Approved.");
          } else if (c.status === "canceled" || c.status === "payment_failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStatus("declined");
            setMessage(
              "The card was declined. Ask the customer to try a different card.",
            );
          }
        } catch {
          // Soft-fail; the next tick will retry.
        }
      }, 2_000);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMessage(
        (err as Error).message?.includes("reader")
          ? "The card reader didn't respond. Make sure it's powered on."
          : "Couldn't start the card payment. Try again or take cash.",
      );
    }
  }

  async function cancelOnReader() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (readerId) {
      try {
        await fetch("/api/pos/payment/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reader_id: readerId }),
        });
      } catch {
        // Best-effort.
      }
    }
    onCancel();
  }

  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-6">
      <p className="text-[var(--color-pos-muted)] mb-4">
        Tap the button to send <b>{formatMoney(amount)}</b> to the card reader.
        The customer taps, inserts, or swipes their card on the reader itself.
      </p>
      {status === "idle" ? (
        <button
          onClick={start}
          className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent)] text-white text-xl font-semibold"
        >
          Send to Reader
        </button>
      ) : (
        <div className="text-center py-2">
          <p className="font-medium">{message}</p>
          {status === "declined" && (
            <p className="mt-2 text-[var(--color-pos-danger)]">
              The card was declined.
            </p>
          )}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              onClick={cancelOnReader}
              className="tap rounded-xl border border-[var(--color-pos-border)] font-medium"
            >
              Cancel
            </button>
            <button
              disabled={
                saving ||
                !intentId ||
                (status !== "waiting" && status !== "approved")
              }
              onClick={() => intentId && onApprove(intentId)}
              className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold disabled:opacity-50"
            >
              {saving
                ? "Saving…"
                : status === "approved"
                  ? "Finish Sale"
                  : "Mark Approved"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
