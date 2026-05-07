"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function NewCustomerPage() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      first_name: String(fd.get("first_name") || ""),
      last_name: nullableString(fd.get("last_name")),
      email: nullableString(fd.get("email")),
      phone: nullableString(fd.get("phone")),
      birthday: nullableString(fd.get("birthday")),
      customer_type:
        (fd.get("customer_type") as
          | "regular"
          | "vip"
          | "staff"
          | "wholesale") ?? "regular",
      notes: nullableString(fd.get("notes")),
    };
    const res = await fetch("/api/pos/customers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't save the customer.");
      return;
    }
    const d = await res.json();
    router.replace(`/customers/${code}/${d.customer.id}`);
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href={`/customers/${code}`}
          className="text-sm text-[var(--color-pos-muted)] underline"
        >
          ← All customers
        </Link>
        <h1 className="text-xl font-bold mt-1">New customer</h1>
      </header>
      <form
        onSubmit={submit}
        className="max-w-xl p-6 grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <Field label="First name *" name="first_name" required />
        <Field label="Last name" name="last_name" />
        <Field label="Email" name="email" type="email" />
        <Field label="Phone" name="phone" />
        <Field label="Birthday" name="birthday" type="date" />
        <label className="text-sm font-medium">
          <span className="block mb-1">Customer type</span>
          <select
            name="customer_type"
            defaultValue="regular"
            className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
          >
            <option value="regular">Regular</option>
            <option value="vip">VIP</option>
            <option value="staff">Staff</option>
            <option value="wholesale">Wholesale</option>
          </select>
        </label>
        <label className="sm:col-span-2 text-sm font-medium">
          <span className="block mb-1">Notes</span>
          <textarea
            name="notes"
            rows={3}
            className="w-full rounded-lg border border-[var(--color-pos-border)] p-2"
          />
        </label>
        {error && (
          <p className="sm:col-span-2 text-[var(--color-pos-danger)]">{error}</p>
        )}
        <div className="sm:col-span-2 flex gap-3 justify-end">
          <Link
            href={`/customers/${code}`}
            className="tap rounded-xl border border-[var(--color-pos-border)] px-5 font-medium flex items-center"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy}
            className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-5"
          >
            {busy ? "Saving…" : "Save customer"}
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
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      <span className="block mb-1">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
      />
    </label>
  );
}

function nullableString(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
