"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewEmployeePage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("set_password") || "");
    const payload = {
      email: String(fd.get("email") || ""),
      pin: String(fd.get("pin") || ""),
      role: String(fd.get("role") || "cashier") as
        | "cashier"
        | "supervisor"
        | "manager"
        | "admin",
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
    router.replace("/admin/employees");
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href="/admin/employees"
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
          <span className="block mb-1">Role</span>
          <select
            name="role"
            defaultValue="cashier"
            className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
          >
            <option value="cashier">Cashier</option>
            <option value="supervisor">Supervisor</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
          <span className="block text-xs text-[var(--color-pos-muted)] mt-1">
            Manager and Admin can sign in to the back office.
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
            href="/admin/employees"
            className="tap rounded-xl border border-[var(--color-pos-border)] px-5 font-medium flex items-center"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy}
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
