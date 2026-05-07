"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type PosRole = { id: number; name: string };

export default function NewEmployeePage() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posRoles, setPosRoles] = useState<PosRole[]>([]);
  const [selectedPosRoleId, setSelectedPosRoleId] = useState<string>("");

  useEffect(() => {
    void fetch("/api/pos/user-roles")
      .then((r) => (r.ok ? r.json() : { roles: [] }))
      .then((d) => {
        const rows: PosRole[] = Array.isArray(d?.roles) ? d.roles : [];
        setPosRoles(rows);
        if (rows[0]) setSelectedPosRoleId(String(rows[0].id));
      })
      .catch(() => setPosRoles([]));
  }, []);

  // Map a POS role *name* down to the legacy four-value enum stored on
  // pos_employees.role so the rest of the codebase (which still keys off
  // that text column) keeps working. Anything we can't map is treated as
  // a cashier.
  function legacyRoleFor(name: string): "cashier" | "supervisor" | "manager" | "admin" {
    const n = name.trim().toLowerCase();
    if (n === "super admin" || n === "admin") return "admin";
    if (n === "manager") return "manager";
    if (n === "supervisor") return "supervisor";
    return "cashier";
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("set_password") || "");
    const posRoleId = selectedPosRoleId ? Number(selectedPosRoleId) : null;
    const posRoleName = posRoles.find((r) => r.id === posRoleId)?.name ?? "";
    const payload: Record<string, unknown> = {
      email: String(fd.get("email") || ""),
      pin: String(fd.get("pin") || ""),
      role: legacyRoleFor(posRoleName),
      ...(posRoleId ? { pos_role_id: posRoleId } : {}),
      ...(password.trim().length >= 8 ? { set_password: password.trim() } : {}),
    };
    const res = await fetch("/api/pos/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't add the employee.");
      return;
    }
    router.replace(`/employees/${code}`);
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href={`/employees/${code}`}
          className="text-sm text-[var(--color-pos-muted)] underline"
        >
          ← All employees
        </Link>
        <h1 className="text-xl font-bold mt-1">New employee</h1>
        <p className="text-xs text-[var(--color-pos-muted)] mt-1">
          The employee&apos;s email must already exist as a WMS user. (The same
          login powers both apps.)
        </p>
      </header>
      <form onSubmit={submit} className="max-w-xl p-6 grid gap-4">
        <Field label="Email" name="email" type="email" required />
        <Field label="Register PIN (4 digits)" name="pin" required pattern="\d{4}" />
        <label className="text-sm font-medium">
          <span className="block mb-1">POS role</span>
          <select
            value={selectedPosRoleId}
            onChange={(e) => setSelectedPosRoleId(e.target.value)}
            className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
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
          <span className="block text-xs text-[var(--color-pos-muted)] mt-1">
            POS roles are configured by the admin from the WMS back office. Super
            Admin and Manager are reserved and don&apos;t appear in this list.
          </span>
        </label>
        <Field
          label="Set / reset their WMS password (optional, min 8 chars)"
          name="set_password"
          type="text"
        />
        {error && <p className="text-[var(--color-pos-danger)]">{error}</p>}
        <div className="flex gap-3 justify-end">
          <Link
            href={`/employees/${code}`}
            className="tap rounded-xl border border-[var(--color-pos-border)] px-5 font-medium flex items-center"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy || posRoles.length === 0}
            className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-5"
          >
            {busy ? "Saving…" : "Add employee"}
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  pattern,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  pattern?: string;
}) {
  return (
    <label className="text-sm font-medium">
      <span className="block mb-1">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        pattern={pattern}
        className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
      />
    </label>
  );
}
