"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";

type Register = {
  id: number;
  name: string;
  location_name: string;
  open_session: { id: number } | null;
};

/**
 * Bill denominations shown in the Open Register dialog. Cents (25¢/10¢/
 * 5¢/1¢) and the "Extra" cash-in-hand line are intentionally omitted —
 * matches the close-register count input.
 */
const DENOMS: Array<{ label: string; value: number }> = [
  { label: "$100 ×", value: 100 },
  { label: "$50 ×",  value: 50 },
  { label: "$20 ×",  value: 20 },
  { label: "$10 ×",  value: 10 },
  { label: "$5 ×",   value: 5 },
  { label: "$1 ×",   value: 1 },
];

/**
 * Smart Open-Register button. Clicking it:
 *   - 1 register at this location → opens the denomination dialog inline
 *   - 2+ registers                → navigates to /sales/{code}/register
 *     (the existing register picker)
 * After opening a session it POSTs to /api/pos/sessions/{id}/print-open
 * so the receipt printer leaves a paper audit trail.
 */
export function OpenRegisterButton({ code }: { code: string }) {
  const router = useRouter();
  const [eligible, setEligible] = useState<Register[] | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load registers on hover/focus so the click is instant. We don't
  // block the initial Sales page render.
  async function ensureRegisters() {
    if (eligible) return eligible;
    const res = await fetch("/api/pos/registers");
    if (!res.ok) {
      setError("Couldn't load registers.");
      return [];
    }
    const data = (await res.json()) as { registers: Register[] };
    // Filter to registers without an open session — those are the ones
    // the cashier could open right now.
    const open = (data.registers ?? []).filter((r) => !r.open_session);
    setEligible(open);
    return open;
  }

  async function onClick() {
    setError(null);
    setLoading(true);
    const list = await ensureRegisters();
    setLoading(false);
    if (list.length === 0) {
      setError(
        "No registers available to open at this location. Ask a manager to add one.",
      );
      return;
    }
    if (list.length === 1) {
      setShowDialog(true);
      return;
    }
    // 2+ → fall through to the existing picker page.
    router.push(`/sales/${code}/register`);
  }

  const onlyRegister = eligible && eligible.length === 1 ? eligible[0] : null;

  return (
    <>
      <button
        type="button"
        onClick={() => void onClick()}
        onMouseEnter={() => void ensureRegisters()}
        onFocus={() => void ensureRegisters()}
        disabled={loading}
        className="tap-lg flex items-center justify-center gap-2 px-4 carbon-btn-primary disabled:opacity-50"
      >
        <span className="material-symbols-outlined">login</span>
        <span className="font-semibold">
          {loading ? "Loading…" : "Open Register"}
        </span>
      </button>
      {error ? (
        <p className="text-carbon-danger text-sm mt-2">{error}</p>
      ) : null}
      {showDialog && onlyRegister ? (
        <OpenRegisterDialog
          code={code}
          register={onlyRegister}
          onCancel={() => setShowDialog(false)}
          onOpened={() => {
            setShowDialog(false);
            router.replace(`/sales/${code}/new`);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function OpenRegisterDialog({
  code,
  register,
  onCancel,
  onOpened,
}: {
  code: string;
  register: Register;
  onCancel: () => void;
  onOpened: () => void;
}) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => {
    const denomTotal = DENOMS.reduce(
      (sum, d) => sum + (counts[d.value] ?? 0) * d.value,
      0,
    );
    return Math.round(denomTotal * 100) / 100;
  }, [counts]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          register_id: register.id,
          opening_cash: total,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(data.message ?? "Couldn't open the register. Try again.");
        return;
      }
      const data = (await res.json()) as { session: { id: number } };
      // Best-effort print + drawer kick. Both can fail (no printer in
      // dev, etc) without blocking the cashier.
      void fetch(`/api/pos/sessions/${data.session.id}/print-open`, {
        method: "POST",
      }).catch(() => undefined);
      onOpened();
    } finally {
      setBusy(false);
    }
  }

  async function openDrawer() {
    await fetch("/api/pos/cash-drawer/kick", { method: "POST" }).catch(
      () => undefined,
    );
  }

  return (
    <Modal title={`Open Register: ${register.name}`} onClose={onCancel}>
      <p className="text-sm text-carbon-text-muted mb-4">
        Count what's already in the drawer at{" "}
        <span className="font-semibold text-carbon-text">
          {register.location_name}
        </span>
        . Total below becomes the opening cash.
      </p>

      <div className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5">
        <span className="text-sm font-bold uppercase tracking-wider text-carbon-text-muted col-span-2 mb-1">
          Opening Count
        </span>
        {DENOMS.map((d) => (
          <DenomRow
            key={d.value}
            label={d.label}
            value={counts[d.value] ?? ""}
            onChange={(n) =>
              setCounts((prev) => ({ ...prev, [d.value]: n }))
            }
          />
        ))}
        <span className="text-sm font-bold text-carbon-text text-right">
          Total
        </span>
        <span className="block text-base font-bold tabular-nums text-carbon-text px-2">
          {formatMoney(total)}
        </span>
      </div>

      {error ? (
        <p className="text-sm text-carbon-danger mt-3">{error}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3 justify-end">
        <button
          type="button"
          onClick={() => void openDrawer()}
          className="carbon-btn-secondary tap px-5 font-semibold text-base"
        >
          Open Drawer
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="carbon-btn-secondary tap px-5 font-semibold text-base"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="carbon-btn-primary tap px-5 font-semibold text-base disabled:opacity-50"
        >
          {busy ? "Opening…" : "Submit Count"}
        </button>
      </div>
    </Modal>
  );
}

function DenomRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | "";
  onChange: (n: number) => void;
}) {
  return (
    <>
      <span className="text-sm font-semibold text-carbon-text text-right whitespace-nowrap">
        {label}
      </span>
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const v = e.target.value === "" ? 0 : Math.max(0, Number(e.target.value));
          onChange(Number.isFinite(v) ? v : 0);
        }}
        className="carbon-input text-right tabular-nums w-24 h-8 px-2 text-base font-semibold text-carbon-text"
        placeholder="0"
      />
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Esc closes the modal — small QoL.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/55 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-md p-6 shadow-lg border border-carbon-border-soft">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-carbon-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-carbon-text-muted hover:text-carbon-text text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
