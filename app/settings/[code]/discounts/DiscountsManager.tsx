"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Rule = {
  id: number;
  name: string;
  type: "percent" | "fixed";
  value: string;
  applies_to: "all" | "customer_type" | "sku_id";
  applies_to_value: string | null;
  start_date: string | null;
  end_date: string | null;
  requires_manager_pin: boolean;
  is_active: boolean;
};

export function DiscountsManager({ rules }: { rules: Rule[] }) {
  return (
    <div className="grid gap-3">
      {rules.map((r) => (
        <RuleRow key={r.id} rule={r} />
      ))}
      <NewRule />
    </div>
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(payload: Partial<Rule>) {
    setBusy(true);
    await fetch(`/api/pos/discount-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-6 gap-3 items-center text-sm">
      <div className="sm:col-span-2">
        <p className="font-semibold">{rule.name}</p>
        <p className="text-xs text-[var(--color-pos-muted)]">
          {rule.type === "percent"
            ? `${Number(rule.value)}% off`
            : `$${Number(rule.value).toFixed(2)} off`}{" "}
          · {rule.applies_to}
          {rule.applies_to_value ? `: ${rule.applies_to_value}` : ""}
        </p>
      </div>
      <p className="text-xs text-[var(--color-pos-muted)]">
        {rule.start_date ?? "any"} → {rule.end_date ?? "any"}
      </p>
      <p className="text-xs">
        {rule.requires_manager_pin ? "Needs manager PIN" : ""}
      </p>
      <button
        onClick={() => patch({ is_active: !rule.is_active })}
        disabled={busy}
        className={`tap rounded-xl font-medium ${
          rule.is_active
            ? "bg-green-50 text-green-800 border border-green-200"
            : "bg-zinc-100 text-zinc-600 border border-zinc-200"
        }`}
      >
        {rule.is_active ? "Active" : "Disabled"}
      </button>
      <button
        onClick={() =>
          patch({ requires_manager_pin: !rule.requires_manager_pin })
        }
        disabled={busy}
        className="tap rounded-xl bg-white border border-[var(--color-pos-border)] font-medium"
      >
        Toggle PIN gate
      </button>
    </div>
  );
}

function NewRule() {
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
      name: String(fd.get("name") || ""),
      type: String(fd.get("type") || "percent") as "percent" | "fixed",
      value: Number(fd.get("value") || 0),
      applies_to: String(fd.get("applies_to") || "all") as
        | "all"
        | "customer_type"
        | "sku_id",
      applies_to_value: ns(fd.get("applies_to_value")),
      start_date: ns(fd.get("start_date")),
      end_date: ns(fd.get("end_date")),
      requires_manager_pin: fd.get("requires_manager_pin") === "on",
    };
    const res = await fetch("/api/pos/discount-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't save the rule.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="tap rounded-xl bg-white border border-dashed border-[var(--color-pos-border)] font-semibold"
      >
        + New discount rule
      </button>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="bg-white border border-dashed border-[var(--color-pos-border)] rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3"
    >
      <Input label="Name *" name="name" required />
      <Select label="Type" name="type" defaultValue="percent">
        <option value="percent">Percent off</option>
        <option value="fixed">Fixed dollar off</option>
      </Select>
      <Input label="Value *" name="value" type="number" step="0.01" required />
      <Select label="Applies to" name="applies_to" defaultValue="all">
        <option value="all">All sales</option>
        <option value="customer_type">Customer type</option>
        <option value="sku_id">A specific SKU</option>
      </Select>
      <Input
        label="Filter (e.g. 'vip' or sku UUID)"
        name="applies_to_value"
      />
      <Input label="Start date" name="start_date" type="date" />
      <Input label="End date" name="end_date" type="date" />
      <label className="text-sm font-medium flex items-center gap-2 mt-5">
        <input type="checkbox" name="requires_manager_pin" />
        Needs manager PIN
      </label>
      <button
        disabled={busy}
        className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold sm:col-span-4"
      >
        {busy ? "Saving…" : "Save rule"}
      </button>
      {error && (
        <p className="sm:col-span-4 text-[var(--color-pos-danger)] text-sm">
          {error}
        </p>
      )}
    </form>
  );
}

function Input({
  label,
  name,
  type = "text",
  step,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  required?: boolean;
}) {
  return (
    <label className="text-xs font-medium">
      <span className="block mb-1">{label}</span>
      <input
        name={name}
        type={type}
        step={step}
        required={required}
        className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
      />
    </label>
  );
}

function Select({
  label,
  name,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-xs font-medium">
      <span className="block mb-1">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
      >
        {children}
      </select>
    </label>
  );
}

function ns(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
