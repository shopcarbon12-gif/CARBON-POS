"use client";

import { useEffect, useState } from "react";

type StripeReader = {
  id: string;
  label: string;
  status: string | null;
  device_type: string | null;
  serial_number: string | null;
};

type Register = {
  id: number;
  name: string;
  location_name: string;
  stripe_reader_id: string | null;
  stripe_reader_label: string | null;
};

type Resp = {
  stripe_readers: StripeReader[];
  stripe_error: string | null;
  registers: Register[];
};

export function ReadersManager() {
  const [data, setData] = useState<Resp | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  async function refresh() {
    const r = await fetch("/api/pos/readers").then((x) => x.json());
    setData(r);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function pair(register: Register, readerId: string | null) {
    setSavingId(register.id);
    const stripe = data?.stripe_readers.find((x) => x.id === readerId) ?? null;
    await fetch("/api/pos/readers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        register_id: register.id,
        reader_id: readerId,
        reader_label: stripe ? stripe.label : null,
      }),
    });
    setSavingId(null);
    refresh();
  }

  if (!data) {
    return <p className="text-[var(--color-pos-muted)]">Loading…</p>;
  }
  return (
    <div className="grid gap-4">
      {data.stripe_error && (
        <p className="bg-amber-50 text-amber-900 rounded-xl px-4 py-2 text-sm">
          {data.stripe_error}
        </p>
      )}
      <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
        <h2 className="font-semibold mb-2">Readers on your Stripe account</h2>
        {data.stripe_readers.length === 0 ? (
          <p className="text-sm text-[var(--color-pos-muted)]">
            No readers found. Pair a Verifone P400 / BBPOS WisePOS E in your
            Stripe Dashboard, then refresh this page.
          </p>
        ) : (
          <ul className="text-sm divide-y divide-[var(--color-pos-border)]">
            {data.stripe_readers.map((r) => (
              <li key={r.id} className="py-2 flex justify-between">
                <span>
                  {r.label}
                  <span className="ml-2 text-xs text-[var(--color-pos-muted)]">
                    {r.device_type} · {r.serial_number} · {r.status}
                  </span>
                </span>
                <span className="font-mono text-xs text-[var(--color-pos-muted)]">
                  {r.id}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
        <h2 className="font-semibold mb-2">Register pairings</h2>
        {data.registers.length === 0 ? (
          <p className="text-sm text-[var(--color-pos-muted)]">
            No registers yet. Create one under Settings → Registers.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-pos-border)]">
            {data.registers.map((r) => (
              <li
                key={r.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-[var(--color-pos-muted)] ml-2">
                    {r.location_name}
                  </span>
                </span>
                <select
                  value={r.stripe_reader_id ?? ""}
                  onChange={(e) =>
                    pair(r, e.target.value === "" ? null : e.target.value)
                  }
                  disabled={savingId === r.id}
                  className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
                >
                  <option value="">— No reader —</option>
                  {data.stripe_readers.map((sr) => (
                    <option key={sr.id} value={sr.id}>
                      {sr.label} ({sr.device_type})
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
