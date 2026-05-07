"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
 * /customers/{code}/{id}. Layout follows the supplied screenshot:
 *
 *   left column  : Type, Created (display only on edit), Biographical, Phones
 *   middle column: Address, Other (Email 1 / Email 2), Tags
 *   right column : Contact channel + consent
 *   below        : Notes
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
      const j = (await res.json()) as { customer?: { id?: number } };
      const newId = j.customer?.id;
      router.replace(
        newId ? `/customers/${code}/${newId}` : `/customers/${code}`,
      );
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Type / Created / Biographical / Phones */}
        <div className="space-y-6">
          <Section title={null}>
            <Row label="Type">
              <select
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
            </Row>
            {isEdit ? (
              <Row label="Created">
                <span className="text-sm text-[var(--color-pos-muted)]">
                  {initial?.created_at
                    ? new Date(initial.created_at).toLocaleString()
                    : "—"}
                  {initial?.created_by_email ? (
                    <>
                      {" "}
                      <span className="opacity-75">
                        by {initial.created_by_email}
                      </span>
                    </>
                  ) : null}
                </span>
              </Row>
            ) : null}
          </Section>

          <Section title="Biographical">
            <Row label="First Name">
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="First Name"
              />
            </Row>
            <Row label="Last Name">
              <input
                value={lastName ?? ""}
                onChange={(e) => setLastName(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Last Name"
              />
            </Row>
            <Row label="Company">
              <input
                value={company ?? ""}
                onChange={(e) => setCompany(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Company"
              />
            </Row>
            <Row label="Birth Date">
              <input
                type="date"
                value={birthday ?? ""}
                onChange={(e) => setBirthday(e.target.value)}
                className="carbon-input tap w-full"
              />
            </Row>
          </Section>

          <Section title="Phones (numeric only)">
            <Row label="Home">
              <input
                inputMode="tel"
                value={homePhone ?? ""}
                onChange={(e) => setHomePhone(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Home"
              />
            </Row>
            <Row label="Work">
              <input
                inputMode="tel"
                value={workPhone ?? ""}
                onChange={(e) => setWorkPhone(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Work"
              />
            </Row>
            <Row label="Mobile">
              <input
                inputMode="tel"
                value={mobilePhone ?? ""}
                onChange={(e) => setMobilePhone(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Mobile"
              />
            </Row>
          </Section>
        </div>

        {/* MIDDLE: Address / Other / Tags */}
        <div className="space-y-6">
          <Section title="Address">
            <Row label="Country">
              <input
                value={country ?? ""}
                onChange={(e) => setCountry(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Country"
              />
            </Row>
            <Row label="Address">
              <input
                value={address1 ?? ""}
                onChange={(e) => setAddress1(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Address"
              />
            </Row>
            <Row label="Address 2">
              <input
                value={address2 ?? ""}
                onChange={(e) => setAddress2(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Address 2"
              />
            </Row>
            <Row label="City">
              <input
                value={city ?? ""}
                onChange={(e) => setCity(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="City"
              />
            </Row>
            <Row label="State">
              <input
                value={state ?? ""}
                onChange={(e) => setState(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="State"
              />
            </Row>
            <Row label="ZIP">
              <input
                value={zip ?? ""}
                onChange={(e) => setZip(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="ZIP"
              />
            </Row>
          </Section>

          <Section title="Other">
            <Row label="Email 1">
              <input
                type="email"
                value={email1 ?? ""}
                onChange={(e) => setEmail1(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Email 1"
              />
            </Row>
            <Row label="Email 2">
              <input
                type="email"
                value={email2 ?? ""}
                onChange={(e) => setEmail2(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="Email 2"
              />
            </Row>
          </Section>

          <Section title="Tags">
            <Row label={null}>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="carbon-input tap w-full"
                placeholder="comma-separated tag(s)"
              />
            </Row>
          </Section>
        </div>

        {/* RIGHT: Contact channel + consent */}
        <div className="space-y-6">
          <Section title="Contact">
            <p className="text-xs text-[var(--color-pos-muted)] px-3 pt-1 pb-2">
              To select your customer&apos;s preferred contact method, you need
              their explicit consent.
            </p>
            <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium">
                Yes, I have consent from my customer.
              </span>
            </label>
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
              label="Call"
              checked={callOk}
              disabled={!consent}
              onChange={setCallOk}
            />
          </Section>
        </div>
      </div>

      {/* Notes (full width) */}
      <Section title="Notes">
        <div className="px-3 py-2">
          <p className="text-xs text-[var(--color-pos-muted)] mb-2">
            Don&apos;t enter sensitive information like login or credit card
            details
          </p>
          <textarea
            value={notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            className="carbon-input w-full p-3"
          />
        </div>
      </Section>

      {error && <p className="text-carbon-danger">{error}</p>}
      {done && <p className="text-green-700">Saved ✓</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || firstName.trim().length === 0}
          className="carbon-btn-primary tap px-5 font-semibold"
        >
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create customer"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-[var(--color-pos-border)] bg-white">
      {title ? (
        <h3 className="bg-[var(--color-pos-bg)] px-3 py-2 text-sm font-bold border-b border-[var(--color-pos-border)]">
          {title}
        </h3>
      ) : null}
      <div className="divide-y divide-[var(--color-pos-border)]">{children}</div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-3 px-3 py-2">
      {label ? (
        <label className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted">
          {label}
        </label>
      ) : (
        <span />
      )}
      <div>{children}</div>
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
      className={`flex items-center justify-between gap-3 px-3 py-2 cursor-pointer ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <span className="text-sm font-medium">{label}</span>
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4"
      />
    </label>
  );
}

function ns(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}
