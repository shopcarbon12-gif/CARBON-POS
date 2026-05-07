"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Initial = {
  id: number;
  role: "cashier" | "supervisor" | "manager" | "admin";
  is_active: boolean;
};

export function EmployeeEditor({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [role, setRole] = useState<Initial["role"]>(initial.role);
  const [active, setActive] = useState(initial.is_active);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setDone(false);
    const res = await fetch(`/api/pos/employees/${initial.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't save changes.");
      return false;
    }
    setDone(true);
    router.refresh();
    return true;
  }

  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-5 grid gap-4">
      <label className="text-sm font-medium">
        <span className="block mb-1">Role</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Initial["role"])}
          className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
        >
          <option value="cashier">Cashier</option>
          <option value="supervisor">Supervisor</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="w-5 h-5"
        />
        Account is active
      </label>
      <button
        disabled={busy}
        onClick={() => patch({ role, is_active: active })}
        className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold"
      >
        {busy ? "Saving…" : "Save role / status"}
      </button>

      <div className="border-t border-[var(--color-pos-border)] pt-4">
        <label className="text-sm font-medium">
          <span className="block mb-1">Reset PIN (4 digits)</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            pattern="\d{4}"
            inputMode="numeric"
            placeholder="0000"
            className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
          />
        </label>
        <button
          disabled={busy || !/^\d{4}$/.test(pin)}
          onClick={async () => {
            const ok = await patch({ pin });
            if (ok) setPin("");
          }}
          className="tap rounded-xl bg-white border border-[var(--color-pos-border)] font-semibold mt-2 w-full"
        >
          Set new PIN
        </button>
      </div>

      {error && <p className="text-[var(--color-pos-danger)]">{error}</p>}
      {done && <p className="text-green-700">Saved ✓</p>}
    </div>
  );
}
