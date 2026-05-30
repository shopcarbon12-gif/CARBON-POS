"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Initial = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  pos_role_id: number | null;
  pos_role_name: string | null;
  role: "cashier" | "supervisor" | "manager" | "admin";
  is_active: boolean;
};

type PosRole = { id: number; name: string };

export function EmployeeEditor({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.first_name);
  const [lastName, setLastName] = useState(initial.last_name);
  const [email, setEmail] = useState(initial.email);
  const [roleId, setRoleId] = useState<string>(
    initial.pos_role_id ? String(initial.pos_role_id) : "",
  );
  const [active, setActive] = useState(initial.is_active);
  const [posRoles, setPosRoles] = useState<PosRole[]>([]);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/pos/user-roles")
      .then((r) => (r.ok ? r.json() : { roles: [] }))
      .then((d) => {
        const rows: PosRole[] = Array.isArray(d?.roles) ? d.roles : [];
        // Keep the employee's current role visible even if it's filtered out
        // of the assignable list (e.g. Super Admin for a non-admin viewer).
        if (
          initial.pos_role_id &&
          initial.pos_role_name &&
          !rows.some((r) => r.id === initial.pos_role_id)
        ) {
          rows.unshift({ id: initial.pos_role_id, name: initial.pos_role_name });
        }
        setPosRoles(rows);
      })
      .catch(() => setPosRoles([]));
  }, [initial.pos_role_id, initial.pos_role_name]);

  async function patch(payload: Record<string, unknown>, successMsg = true) {
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
    if (successMsg) setDone(true);
    router.refresh();
    return true;
  }

  const inputCls = "carbon-input tap w-full mt-1";

  return (
    <div className="bg-white border border-[var(--color-pos-border)] p-5 grid gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="text-sm font-medium">
          <span className="block mb-1">First name</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputCls}
            placeholder="First name"
          />
        </label>
        <label className="text-sm font-medium">
          <span className="block mb-1">Last name</span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputCls}
            placeholder="Last name"
          />
        </label>
      </div>

      <label className="text-sm font-medium">
        <span className="block mb-1">Email (login identity)</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
          placeholder="name@example.com"
        />
      </label>

      <label className="text-sm font-medium">
        <span className="block mb-1">Role</span>
        <select
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          className={inputCls}
        >
          {posRoles.length === 0 ? (
            <option value="">— No POS roles available —</option>
          ) : (
            posRoles.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.name}
              </option>
            ))
          )}
        </select>
      </label>

      <button
        disabled={busy}
        onClick={() =>
          patch({
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            email: email.trim(),
            ...(roleId ? { pos_role_id: Number(roleId) } : {}),
          })
        }
        className="carbon-btn-primary tap inline-flex items-center justify-center font-semibold"
      >
        {busy ? "Saving…" : "Save"}
      </button>

      {/* Archive / Unarchive */}
      <div className="border-t border-[var(--color-pos-border)] pt-4">
        {active ? (
          <button
            disabled={busy}
            onClick={async () => {
              if (
                !confirm(
                  "Archive this employee? They won't be able to sign in to POS until you unarchive them.",
                )
              )
                return;
              const ok = await patch({ is_active: false }, false);
              if (ok) setActive(false);
            }}
            className="carbon-btn-secondary tap w-full font-semibold text-[var(--color-pos-danger)]"
          >
            Archive employee
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={async () => {
              const ok = await patch({ is_active: true }, false);
              if (ok) setActive(true);
            }}
            className="carbon-btn-secondary tap w-full font-semibold text-carbon-blue"
          >
            Unarchive employee
          </button>
        )}
      </div>

      {/* Reset PIN */}
      <div className="border-t border-[var(--color-pos-border)] pt-4">
        <label className="text-sm font-medium">
          <span className="block mb-1">Reset PIN (4 digits)</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            maxLength={4}
            placeholder="0000"
            className={inputCls}
          />
        </label>
        <button
          disabled={busy || !/^\d{4}$/.test(pin)}
          onClick={async () => {
            const ok = await patch({ pin });
            if (ok) setPin("");
          }}
          className="carbon-btn-secondary tap w-full font-semibold mt-2"
        >
          Set new PIN
        </button>
      </div>

      {error && <p className="text-[var(--color-pos-danger)]">{error}</p>}
      {done && <p className="text-carbon-success">Saved ✓</p>}
    </div>
  );
}
