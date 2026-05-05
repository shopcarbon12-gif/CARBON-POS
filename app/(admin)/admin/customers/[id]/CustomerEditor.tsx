"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Customer = {
  id: number;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  customer_type: "regular" | "vip" | "staff" | "wholesale";
  notes: string | null;
};

export function CustomerEditor({ initial }: { initial: Customer }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    const fd = new FormData(e.currentTarget);
    const payload = {
      first_name: String(fd.get("first_name") || ""),
      last_name: ns(fd.get("last_name")),
      email: ns(fd.get("email")),
      phone: ns(fd.get("phone")),
      birthday: ns(fd.get("birthday")),
      customer_type: fd.get("customer_type") as Customer["customer_type"],
      notes: ns(fd.get("notes")),
    };
    const res = await fetch(`/api/pos/customers/${initial.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't save changes.");
      return;
    }
    setDone(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={save}
      className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white border border-[var(--color-pos-border)] rounded-2xl p-5"
    >
      <Field
        label="First name *"
        name="first_name"
        defaultValue={initial.first_name}
        required
      />
      <Field
        label="Last name"
        name="last_name"
        defaultValue={initial.last_name ?? ""}
      />
      <Field
        label="Email"
        name="email"
        type="email"
        defaultValue={initial.email ?? ""}
      />
      <Field
        label="Phone"
        name="phone"
        defaultValue={initial.phone ?? ""}
      />
      <Field
        label="Birthday"
        name="birthday"
        type="date"
        defaultValue={initial.birthday ?? ""}
      />
      <label className="text-sm font-medium">
        <span className="block mb-1">Customer type</span>
        <select
          name="customer_type"
          defaultValue={initial.customer_type}
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
          defaultValue={initial.notes ?? ""}
          className="w-full rounded-lg border border-[var(--color-pos-border)] p-2"
        />
      </label>
      {error && (
        <p className="sm:col-span-2 text-[var(--color-pos-danger)]">{error}</p>
      )}
      {done && (
        <p className="sm:col-span-2 text-green-700">Saved ✓</p>
      )}
      <div className="sm:col-span-2 flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-5"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="text-sm font-medium">
      <span className="block mb-1">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
      />
    </label>
  );
}

function ns(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
