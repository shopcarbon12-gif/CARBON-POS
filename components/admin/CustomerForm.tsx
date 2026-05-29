"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  User,
  Phone,
  MapPin,
  Mail,
  Tag,
  Bell,
  FileText,
  type LucideIcon,
} from "lucide-react";

export type CustomerFormInitial = {
  id?: number;
  customer_type?: "regular" | "vip" | "staff" | "wholesale";
  first_name?: string;
  last_name?: string | null;
  company?: string | null;
  birthday?: string | null;
  home_phone?: string | null;
  work_phone?: string | null;
  mobile_phone?: string | null;
  email?: string | null;
  email_2?: string | null;
  country?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  tags?: string[] | null;
  contact_consent?: boolean;
  contact_email_ok?: boolean;
  contact_mail_ok?: boolean;
  contact_call_ok?: boolean;
  notes?: string | null;
  /** Display-only on the edit page. */
  created_at?: string | null;
  /** Display-only — the email of the user who created this row. */
  created_by_email?: string | null;
};

/**
 * Shared customer form used on both /customers/{code}/new and the editor on
 * /customers/{code}/{id}. Three-column card layout with stacked,
 * plain-language field labels for a friendlier feel:
 *
 *   left column  : Profile (Type, Created on edit, name, company, birthday),
 *                  Phone numbers
 *   middle column: Address, Email, Tags
 *   right column : Contact preferences (consent + channels), Notes
 *
 * Per spec we OMIT: Discount, Sales Tax, Title, Pager, Fax, Custom field,
 * Website, Custom (in Other), Saved Payment Methods, Custom Fields panel.
 */
export function CustomerForm({
  code,
  initial,
}: {
  code: string;
  initial: CustomerFormInitial | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEdit = Boolean(initial?.id);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [type, setType] = useState<"regular" | "vip" | "staff" | "wholesale">(
    initial?.customer_type ?? "regular",
  );
  const [firstName, setFirstName] = useState(initial?.first_name ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [homePhone, setHomePhone] = useState(initial?.home_phone ?? "");
  const [workPhone, setWorkPhone] = useState(initial?.work_phone ?? "");
  const [mobilePhone, setMobilePhone] = useState(initial?.mobile_phone ?? "");
  const [country, setCountry] = useState(initial?.country ?? "");
  const [address1, setAddress1] = useState(initial?.address_line1 ?? "");
  const [address2, setAddress2] = useState(initial?.address_line2 ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [state, setState] = useState(initial?.state ?? "");
  const [zip, setZip] = useState(initial?.zip ?? "");
  const [email1, setEmail1] = useState(initial?.email ?? "");
  const [email2, setEmail2] = useState(initial?.email_2 ?? "");
  const [tagsInput, setTagsInput] = useState((initial?.tags ?? []).join(", "));
  const [consent, setConsent] = useState(initial?.contact_consent ?? false);
  const [emailOk, setEmailOk] = useState(initial?.contact_email_ok ?? false);
  const [mailOk, setMailOk] = useState(initial?.contact_mail_ok ?? false);
  const [callOk, setCallOk] = useState(initial?.contact_call_ok ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  // Reset state if the parent passes a different `initial` (used when the
  // edit page revalidates after a save).
  useEffect(() => {
    if (!initial) return;
    setType(initial.customer_type ?? "regular");
    setFirstName(initial.first_name ?? "");
    setLastName(initial.last_name ?? "");
    setCompany(initial.company ?? "");
    setBirthday(initial.birthday ?? "");
    setHomePhone(initial.home_phone ?? "");
    setWorkPhone(initial.work_phone ?? "");
    setMobilePhone(initial.mobile_phone ?? "");
    setCountry(initial.country ?? "");
    setAddress1(initial.address_line1 ?? "");
    setAddress2(initial.address_line2 ?? "");
    setCity(initial.city ?? "");
    setState(initial.state ?? "");
    setZip(initial.zip ?? "");
    setEmail1(initial.email ?? "");
    setEmail2(initial.email_2 ?? "");
    setTagsInput((initial.tags ?? []).join(", "));
    setConsent(initial.contact_consent ?? false);
    setEmailOk(initial.contact_email_ok ?? false);
    setMailOk(initial.contact_mail_ok ?? false);
    setCallOk(initial.contact_call_ok ?? false);
    setNotes(initial.notes ?? "");
  }, [initial]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const payload: Record<string, unknown> = {
      customer_type: type,
      first_name: firstName.trim(),
      last_name: ns(lastName),
      company: ns(company),
      birthday: ns(birthday),
      home_phone: ns(homePhone),
      work_phone: ns(workPhone),
      mobile_phone: ns(mobilePhone),
      country: ns(country),
      address_line1: ns(address1),
      address_line2: ns(address2),
      city: ns(city),
      state: ns(state),
      zip: ns(zip),
      email: ns(email1),
      email_2: ns(email2),
      tags,
      contact_consent: consent,
      contact_email_ok: emailOk,
      contact_mail_ok: mailOk,
      contact_call_ok: callOk,
      notes: ns(notes),
    };

    const res = await fetch(
      isEdit ? `/api/pos/customers/${initial!.id}` : "/api/pos/customers",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      setError(j.message ?? "Couldn't save the customer.");
      return;
    }
    if (isEdit) {
      setDone(true);
      router.refresh();
    } else {
      const j = (await res.json()) as {
        customer?: {
          id?: number;
          first_name?: string;
          last_name?: string | null;
          email?: string | null;
          mobile_phone?: string | null;
          phone?: string | null;
        };
      };
      const c = j.customer;
      const newId = c?.id;
      // ?next=…  round-trip — used by the POS sell screen so a new
      // customer gets attached to the in-progress sale on return.
      const next = searchParams.get("next");
      if (newId && next && next.startsWith("/")) {
        const fullName = [c?.first_name, c?.last_name]
          .filter(Boolean)
          .join(" ");
        const params = new URLSearchParams();
        params.set("customer_id", String(newId));
        params.set("customer_name", fullName);
        if (c?.email) params.set("customer_email", c.email);
        const phone = c?.mobile_phone || c?.phone;
        if (phone) params.set("customer_phone", phone);
        const sep = next.includes("?") ? "&" : "?";
        router.replace(`${next}${sep}${params.toString()}`);
        return;
      }
      router.replace(
        newId ? `/customers/${code}/${newId}` : `/customers/${code}`,
      );
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 min-w-0">
      <p className="text-sm text-carbon-text-muted">
        Fields marked <span className="text-carbon-danger font-semibold">*</span>{" "}
        are required. Everything else you can fill in later.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-w-0">
        {/* LEFT: Profile + Phones */}
        <div className="space-y-6 min-w-0">
          <Section title="Profile" icon={User}>
            <Field label="Customer type" htmlFor="cust-type">
              <select
                id="cust-type"
                value={type}
                onChange={(e) =>
                  setType(
                    e.target.value as "regular" | "vip" | "staff" | "wholesale",
                  )
                }
                className="carbon-input tap w-full"
              >
                <option value="regular">Regular</option>
                <option value="vip">VIP</option>
                <option value="staff">Staff</option>
                <option value="wholesale">Wholesale</option>
              </select>
            </Field>
            {isEdit ? (
              <Field label="Created">
                <p className="text-sm text-carbon-text-muted">
                  {initial?.created_at
                    ? new Date(initial.created_at).toLocaleString()
                    : "—"}
                  {initial?.created_by_email ? (
                    <span className="opacity-75">
                      {" "}
                      by {initial.created_by_email}
                    </span>
                  ) : null}
                </p>
              </Field>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First name" htmlFor="cust-first" required>
                <input
                  id="cust-first"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="carbon-input tap w-full"
                  placeholder="Jane"
                />
              </Field>
              <Field label="Last name" htmlFor="cust-last">
                <input
                  id="cust-last"
                  value={lastName ?? ""}
                  onChange={(e) => setLastName(e.target.value)}
                  className="carbon-input tap w-full"
                  placeholder="Doe"
                />
              </Field>
            </div>
            <Field label="Company" htmlFor="cust-company">
              <input
                id="cust-company"
                value={company ?? ""}
                onChange={(e) => setCompany(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Optional"
              />
            </Field>
            <Field label="Birth date" htmlFor="cust-birthday">
              <input
                id="cust-birthday"
                type="date"
                value={birthday ?? ""}
                onChange={(e) => setBirthday(e.target.value)}
                className="carbon-input tap w-full"
              />
            </Field>
          </Section>

          <Section title="Phone numbers" icon={Phone}>
            <Field label="Mobile" htmlFor="cust-mobile">
              <input
                id="cust-mobile"
                inputMode="tel"
                value={mobilePhone ?? ""}
                onChange={(e) => setMobilePhone(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Numbers only"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Home" htmlFor="cust-home">
                <input
                  id="cust-home"
                  inputMode="tel"
                  value={homePhone ?? ""}
                  onChange={(e) => setHomePhone(e.target.value)}
                  className="carbon-input tap w-full"
                  placeholder="Numbers only"
                />
              </Field>
              <Field label="Work" htmlFor="cust-work">
                <input
                  id="cust-work"
                  inputMode="tel"
                  value={workPhone ?? ""}
                  onChange={(e) => setWorkPhone(e.target.value)}
                  className="carbon-input tap w-full"
                  placeholder="Numbers only"
                />
              </Field>
            </div>
          </Section>
        </div>

        {/* MIDDLE: Address / Email / Tags */}
        <div className="space-y-6 min-w-0">
          <Section title="Address" icon={MapPin}>
            <Field label="Street address" htmlFor="cust-addr1">
              <input
                id="cust-addr1"
                value={address1 ?? ""}
                onChange={(e) => setAddress1(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="123 Main St"
              />
            </Field>
            <Field label="Apartment, suite, etc." htmlFor="cust-addr2">
              <input
                id="cust-addr2"
                value={address2 ?? ""}
                onChange={(e) => setAddress2(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Optional"
              />
            </Field>
            <Field label="City" htmlFor="cust-city">
              <input
                id="cust-city"
                value={city ?? ""}
                onChange={(e) => setCity(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="City"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="State / Region" htmlFor="cust-state">
                <input
                  id="cust-state"
                  value={state ?? ""}
                  onChange={(e) => setState(e.target.value)}
                  className="carbon-input tap w-full"
                  placeholder="State"
                />
              </Field>
              <Field label="ZIP / Postal code" htmlFor="cust-zip">
                <input
                  id="cust-zip"
                  value={zip ?? ""}
                  onChange={(e) => setZip(e.target.value)}
                  className="carbon-input tap w-full"
                  placeholder="ZIP"
                />
              </Field>
            </div>
            <Field label="Country" htmlFor="cust-country">
              <input
                id="cust-country"
                value={country ?? ""}
                onChange={(e) => setCountry(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Country"
              />
            </Field>
          </Section>

          <Section title="Email" icon={Mail}>
            <Field label="Primary email" htmlFor="cust-email1">
              <input
                id="cust-email1"
                type="email"
                value={email1 ?? ""}
                onChange={(e) => setEmail1(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="name@example.com"
              />
            </Field>
            <Field label="Secondary email" htmlFor="cust-email2">
              <input
                id="cust-email2"
                type="email"
                value={email2 ?? ""}
                onChange={(e) => setEmail2(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Optional"
              />
            </Field>
          </Section>

          <Section title="Tags" icon={Tag}>
            <Field
              label="Tags"
              htmlFor="cust-tags"
              hint="Separate multiple tags with commas — e.g. local, frequent, gift-buyer."
            >
              <input
                id="cust-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="local, frequent"
              />
            </Field>
          </Section>
        </div>

        {/* RIGHT: Contact preferences + consent */}
        <div className="space-y-6 min-w-0">
          <Section title="Contact preferences" icon={Bell}>
            <p className="text-sm text-carbon-text-muted">
              To set how this customer prefers to hear from you, first confirm
              you have their explicit consent.
            </p>
            <label className="flex items-start gap-2.5 border border-carbon-border bg-carbon-surface-soft p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="w-5 h-5 mt-0.5 accent-carbon-blue shrink-0"
              />
              <span className="text-sm font-medium">
                Yes, I have consent from my customer.
              </span>
            </label>
            <div className="space-y-2">
              <ChannelRow
                label="Email"
                checked={emailOk}
                disabled={!consent}
                onChange={setEmailOk}
              />
              <ChannelRow
                label="Mail"
                checked={mailOk}
                disabled={!consent}
                onChange={setMailOk}
              />
              <ChannelRow
                label="Phone call"
                checked={callOk}
                disabled={!consent}
                onChange={setCallOk}
              />
            </div>
          </Section>

          <Section title="Notes" icon={FileText}>
            <Field
              label="Internal notes"
              htmlFor="cust-notes"
              hint="Don't enter sensitive information like login or credit card details."
            >
              <textarea
                id="cust-notes"
                value={notes ?? ""}
                onChange={(e) => setNotes(e.target.value)}
                rows={6}
                className="carbon-input w-full py-2.5"
                placeholder="Preferences, allergies, sizing, anything worth remembering…"
              />
            </Field>
          </Section>
        </div>
      </div>

      {error && (
        <div className="border border-carbon-danger bg-[rgba(186,26,26,0.06)] px-4 py-3 text-sm font-medium text-carbon-danger">
          {error}
        </div>
      )}
      {done && (
        <div className="border border-carbon-success bg-[rgba(22,138,63,0.08)] px-4 py-3 text-sm font-medium text-carbon-success">
          Saved ✓ — your changes are live.
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 border-t border-carbon-border pt-5">
        <Link
          href={`/customers/${code}`}
          className="carbon-btn-secondary tap inline-flex items-center justify-center px-6 font-semibold"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={busy || firstName.trim().length === 0}
          className="carbon-btn-primary tap inline-flex items-center justify-center px-6 font-semibold"
        >
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create customer"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-carbon-border bg-white">
      <div className="flex items-center gap-2.5 bg-carbon-surface-soft px-4 py-3 border-b border-carbon-border">
        {Icon ? (
          <Icon className="w-4 h-4 text-carbon-blue shrink-0" strokeWidth={2.25} />
        ) : null}
        <h3 className="text-sm font-bold tracking-tight">{title}</h3>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1 text-sm font-semibold text-carbon-text"
      >
        {label}
        {required ? (
          <span className="text-carbon-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p className="text-xs text-carbon-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function ChannelRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 border border-carbon-border-soft px-3 py-2.5 ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer hover:bg-carbon-surface-soft"
      }`}
    >
      <span className="text-sm font-medium">{label}</span>
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 accent-carbon-blue"
      />
    </label>
  );
}

function ns(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}
