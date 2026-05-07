"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/utils";

/**
 * Bill denominations shown for the cash row. Per spec we omit cents
 * (25¢ / 10¢ / 5¢ / 1¢) and the "Extra" line.
 */
const DENOMS: Array<{ label: string; value: number }> = [
  { label: "$100 ×", value: 100 },
  { label: "$50 ×", value: 50 },
  { label: "$20 ×", value: 20 },
  { label: "$10 ×", value: 10 },
  { label: "$5 ×", value: 5 },
  { label: "$1 ×", value: 1 },
];

type RowKind = "cash" | "amount" | "readonly";

export type CloseRow = {
  key: string;
  label: string;
  startAdds: number;
  payments: number;
  withdraws: number;
  remaining: number;
  kind: RowKind;
};

export function CloseRegisterClient({
  sessionId,
  code,
  rows,
}: {
  sessionId: number;
  code: string;
  rows: CloseRow[];
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cashCounted = useMemo(() => {
    return DENOMS.reduce((sum, d) => sum + (counts[d.value] ?? 0) * d.value, 0);
  }, [counts]);

  const totals = useMemo(() => {
    let startAdds = 0,
      payments = 0,
      withdraws = 0,
      remaining = 0;
    for (const r of rows) {
      startAdds += r.startAdds;
      payments += r.payments;
      withdraws += r.withdraws;
      remaining += r.remaining;
    }
    return { startAdds, payments, withdraws, remaining };
  }, [rows]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pos/sessions/${sessionId}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          closing_cash_counted: Math.round(cashCounted * 100) / 100,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setError(j.message ?? "Couldn't close the register.");
        return;
      }
      router.replace(`/sales/${code}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function openDrawer() {
    setError(null);
    try {
      // Best-effort cash-drawer kick. The print endpoint already kicks the
      // drawer when CASH_DRAWER_KICK=1; we hit the dedicated kicker if it
      // exists, otherwise no-op.
      await fetch("/api/pos/cash-drawer/kick", { method: "POST" }).catch(
        () => undefined,
      );
    } catch {
      /* ignore — informational only */
    }
  }

  return (
    <>
      <div className="overflow-x-auto carbon-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-[var(--carbon-surface-soft)] border-b border-carbon-border-soft text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted">
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Start+Adds</th>
              <th className="text-right px-4 py-3">Payments</th>
              <th className="text-right px-4 py-3">Withdraws</th>
              <th className="text-right px-4 py-3">Total Remaining</th>
              <th className="text-right px-4 py-3 min-w-[280px]">
                Closing Count
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-carbon-border-soft">
            {rows.map((r) => (
              <tr key={r.key} className="align-top">
                <td className="px-4 py-3 font-semibold align-top">{r.label}</td>
                <td className="px-4 py-3 text-right tabular-nums align-top">
                  {formatMoney(r.startAdds)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums align-top">
                  {formatMoney(r.payments)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums align-top">
                  {formatMoney(r.withdraws)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums align-top">
                  {formatMoney(r.remaining)}
                </td>
                <td className="px-4 py-3 align-top">
                  {r.kind === "cash" ? (
                    <CashCountInputs
                      counts={counts}
                      onChange={setCounts}
                      total={cashCounted}
                    />
                  ) : r.kind === "amount" ? (
                    <DollarInput
                      value={amounts[r.key] ?? ""}
                      onChange={(v) =>
                        setAmounts((prev) => ({ ...prev, [r.key]: v }))
                      }
                    />
                  ) : (
                    <span className="block text-right tabular-nums text-carbon-text-muted">
                      {formatMoney(0)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            <tr className="bg-[var(--carbon-surface-soft)] font-bold">
              <td className="px-4 py-3">Totals</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatMoney(totals.startAdds)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatMoney(totals.payments)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatMoney(totals.withdraws)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatMoney(totals.remaining)}
              </td>
              <td className="px-4 py-3" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes */}
      <div className="mt-6">
        <label className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted mb-2 block">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Anything worth flagging on this close — over/short reasons, drawer issues, manager overrides…"
          className="carbon-input w-full p-3"
        />
      </div>

      {error ? (
        <p className="text-carbon-danger mt-4">{error}</p>
      ) : null}

      {/* Buttons */}
      <div className="mt-6 flex flex-wrap gap-3 justify-end">
        <button
          type="button"
          onClick={() => void openDrawer()}
          className="carbon-btn-secondary tap px-5 font-semibold"
        >
          Open Drawer
        </button>
        <Link
          href={`/sales/${code}`}
          className="carbon-btn-secondary tap px-5 font-semibold flex items-center"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="carbon-btn-primary tap px-5 font-semibold disabled:opacity-50"
        >
          {busy ? "Closing…" : "Submit Counts"}
        </button>
      </div>
    </>
  );
}

function CashCountInputs({
  counts,
  onChange,
  total,
}: {
  counts: Record<number, number>;
  onChange: (next: Record<number, number>) => void;
  total: number;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 max-w-xs ml-auto">
      {DENOMS.map((d) => (
        <Row key={d.value} label={d.label}>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={counts[d.value] ?? ""}
            onChange={(e) => {
              const n = e.target.value === "" ? 0 : Math.max(0, Number(e.target.value));
              onChange({ ...counts, [d.value]: Number.isFinite(n) ? n : 0 });
            }}
            className="carbon-input tap text-right tabular-nums w-24 ml-auto"
            placeholder="0"
          />
        </Row>
      ))}
      <Row label="Total">
        <span className="block text-right tabular-nums font-semibold w-24 ml-auto">
          {formatMoney(total)}
        </span>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-xs text-carbon-text-muted text-right whitespace-nowrap">
        {label}
      </span>
      <div>{children}</div>
    </>
  );
}

function DollarInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 max-w-xs ml-auto">
      <span className="text-carbon-text-muted">$</span>
      <input
        type="number"
        step="0.01"
        min={0}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="carbon-input tap text-right tabular-nums w-32"
      />
    </div>
  );
}
