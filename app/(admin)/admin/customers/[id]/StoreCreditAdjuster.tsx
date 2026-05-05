"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StoreCreditAdjuster({ customerId }: { customerId: number }) {
  const router = useRouter();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const n = Number(delta);
    if (!Number.isFinite(n) || n === 0) {
      setError("Enter a non-zero amount. Use a minus sign to deduct.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/pos/customers/${customerId}/store-credit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delta: n, reason: reason || undefined }),
      },
    );
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't adjust the balance.");
      return;
    }
    setDelta("");
    setReason("");
    router.refresh();
  }

  return (
    <div className="mt-3">
      <label className="text-xs font-medium text-[var(--color-pos-muted)]">
        Adjust balance (use minus to deduct)
      </label>
      <input
        type="number"
        step="0.01"
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
        className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full mt-1"
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full mt-2"
      />
      <button
        onClick={submit}
        disabled={busy}
        className="tap rounded-xl bg-[var(--color-pos-ink)] text-white w-full font-semibold mt-2"
      >
        {busy ? "Saving…" : "Apply"}
      </button>
      {error && (
        <p className="text-xs text-[var(--color-pos-danger)] mt-1">{error}</p>
      )}
    </div>
  );
}
