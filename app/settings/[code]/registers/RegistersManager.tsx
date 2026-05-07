"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Register = {
  id: number;
  name: string;
  pos_location_id: number;
  location_name: string;
  stripe_reader_id: string | null;
  stripe_reader_label: string | null;
  is_active: boolean;
};

type Location = { id: number; name: string };

export function RegistersManager({
  registers,
  locations,
}: {
  registers: Register[];
  locations: Location[];
}) {
  return (
    <div className="grid gap-3">
      {registers.map((r) => (
        <RegisterRow key={r.id} reg={r} />
      ))}
      <NewRegister locations={locations} />
    </div>
  );
}

function RegisterRow({ reg }: { reg: Register }) {
  const router = useRouter();
  const [name, setName] = useState(reg.name);
  const [active, setActive] = useState(reg.is_active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pos/registers/${reg.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, is_active: active }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't save.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
      <label className="text-xs font-medium">
        <span className="block mb-1">Location</span>
        <input
          disabled
          value={reg.location_name}
          className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full bg-[var(--color-pos-bg)]"
        />
      </label>
      <label className="text-xs font-medium">
        <span className="block mb-1">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
        />
      </label>
      <label className="text-xs font-medium">
        <span className="block mb-1">Stripe reader</span>
        <input
          disabled
          value={reg.stripe_reader_label ?? reg.stripe_reader_id ?? "—"}
          className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full bg-[var(--color-pos-bg)]"
        />
      </label>
      <label className="text-xs font-medium flex items-center gap-2 mt-5">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Active
      </label>
      <button
        onClick={save}
        disabled={busy}
        className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {error && (
        <p className="sm:col-span-5 text-[var(--color-pos-danger)] text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function NewRegister({ locations }: { locations: Location[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      pos_location_id: Number(fd.get("pos_location_id")),
      name: String(fd.get("name") || ""),
    };
    const res = await fetch("/api/pos/registers/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't add the register.");
      return;
    }
    router.refresh();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="tap rounded-xl bg-white border border-dashed border-[var(--color-pos-border)] font-semibold"
      >
        + New register
      </button>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="bg-white border border-dashed border-[var(--color-pos-border)] rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
    >
      <label className="text-xs font-medium">
        <span className="block mb-1">Location</span>
        <select
          name="pos_location_id"
          required
          className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium sm:col-span-2">
        <span className="block mb-1">Name</span>
        <input
          name="name"
          required
          placeholder="Register 2"
          className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
        />
      </label>
      <button
        disabled={busy}
        className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold"
      >
        {busy ? "Adding…" : "Add"}
      </button>
      {error && (
        <p className="sm:col-span-4 text-[var(--color-pos-danger)] text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
