"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/utils";

type PosLocationRow = {
  id: number;
  wms_name: string;
  wms_location_id: string;
  tax_rate: string;
  receipt_header: string | null;
  receipt_footer: string | null;
  return_policy: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  timezone: string;
  is_active: boolean;
  register_count: number;
};

type WmsLocationRow = { id: string; name: string };

export function LocationsManager({
  locations,
  availableWmsLocations,
}: {
  locations: PosLocationRow[];
  availableWmsLocations: WmsLocationRow[];
}) {
  return (
    <div className="grid gap-4">
      {locations.map((l) => (
        <LocationCard key={l.id} loc={l} />
      ))}
      {availableWmsLocations.length > 0 && (
        <AddLocationCard wmsLocations={availableWmsLocations} />
      )}
    </div>
  );
}

function LocationCard({ loc }: { loc: PosLocationRow }) {
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
      tax_rate: Number(fd.get("tax_rate")),
      receipt_header: ns(fd.get("receipt_header")),
      receipt_footer: ns(fd.get("receipt_footer")),
      return_policy: ns(fd.get("return_policy")),
      address_line1: ns(fd.get("address_line1")),
      address_line2: ns(fd.get("address_line2")),
      city: ns(fd.get("city")),
      state: ns(fd.get("state")),
      zip: ns(fd.get("zip")),
      phone: ns(fd.get("phone")),
      timezone: String(fd.get("timezone") || "America/New_York"),
      is_active: fd.get("is_active") === "on",
    };
    const res = await fetch(`/api/pos/locations/${loc.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't save the location.");
      return;
    }
    setDone(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={save}
      className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-5"
    >
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="font-semibold">{loc.wms_name}</h2>
          <p className="text-xs text-[var(--color-pos-muted)]">
            {loc.register_count} register
            {loc.register_count === 1 ? "" : "s"} · tax{" "}
            {(Number(loc.tax_rate) * 100).toFixed(2)}% · sample of $100 ={" "}
            {formatMoney(100 + 100 * Number(loc.tax_rate))}
          </p>
        </div>
        <label className="text-xs flex gap-1 items-center">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={loc.is_active}
          />
          Active
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Tax rate (decimal, e.g. 0.07)"
          name="tax_rate"
          type="number"
          step="0.0001"
          min="0"
          max="0.5"
          defaultValue={loc.tax_rate}
        />
        <Field
          label="Timezone"
          name="timezone"
          defaultValue={loc.timezone}
        />
        <Field
          label="Receipt header"
          name="receipt_header"
          defaultValue={loc.receipt_header ?? ""}
        />
        <Field
          label="Receipt footer"
          name="receipt_footer"
          defaultValue={loc.receipt_footer ?? ""}
        />
        <Field
          label="Return policy"
          name="return_policy"
          defaultValue={loc.return_policy ?? ""}
        />
        <Field
          label="Phone"
          name="phone"
          defaultValue={loc.phone ?? ""}
        />
        <Field
          label="Address line 1"
          name="address_line1"
          defaultValue={loc.address_line1 ?? ""}
        />
        <Field
          label="Address line 2"
          name="address_line2"
          defaultValue={loc.address_line2 ?? ""}
        />
        <Field
          label="City"
          name="city"
          defaultValue={loc.city ?? ""}
        />
        <Field
          label="State"
          name="state"
          defaultValue={loc.state ?? ""}
        />
        <Field
          label="ZIP"
          name="zip"
          defaultValue={loc.zip ?? ""}
        />
      </div>
      {error && <p className="text-[var(--color-pos-danger)] mt-2">{error}</p>}
      {done && <p className="text-green-700 mt-2">Saved ✓</p>}
      <div className="flex justify-end mt-3">
        <button
          type="submit"
          disabled={busy}
          className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-5"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function AddLocationCard({ wmsLocations }: { wmsLocations: WmsLocationRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      wms_location_id: String(fd.get("wms_location_id") || ""),
      tax_rate: Number(fd.get("tax_rate") || 0.07),
    };
    const res = await fetch("/api/pos/locations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.message ?? "Couldn't link the location.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="bg-white border border-dashed border-[var(--color-pos-border)] rounded-2xl p-5">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="tap rounded-xl bg-white border border-[var(--color-pos-border)] font-semibold px-5"
        >
          + Link another WMS location
        </button>
      ) : (
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <label className="text-sm font-medium">
            <span className="block mb-1">WMS location</span>
            <select
              name="wms_location_id"
              required
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3 w-full"
            >
              {wmsLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Tax rate"
            name="tax_rate"
            type="number"
            step="0.0001"
            defaultValue="0.07"
          />
          <button
            type="submit"
            disabled={busy}
            className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold"
          >
            {busy ? "Linking…" : "Link"}
          </button>
          {error && (
            <p className="sm:col-span-3 text-[var(--color-pos-danger)]">{error}</p>
          )}
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  step,
  min,
  max,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  type?: string;
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <label className="text-sm font-medium">
      <span className="block mb-1">{label}</span>
      <input
        name={name}
        type={type}
        step={step}
        min={min}
        max={max}
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
