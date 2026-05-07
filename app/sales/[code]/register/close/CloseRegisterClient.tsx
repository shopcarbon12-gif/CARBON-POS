"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/utils";

/**
 * Bill denominations shown for the cash row. Per spec we omit cents
 * (25¢ / 10¢ / 5¢ / 1¢) and the "Extra" line for the close count.
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

type Step = "count" | "summary";

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
  const [step, setStep] = useState<Step>("count");
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

  // Per-row Calculated / Counted / Short-Over for the summary view.
  const summaryRows = useMemo(() => {
    return rows.map((r) => {
      let counted = 0;
      if (r.kind === "cash") counted = cashCounted;
      else if (r.kind === "amount") counted = Number(amounts[r.key] ?? 0) || 0;
      // readonly rows aren't counted by the cashier — Calculated is the
      // truth, Counted just mirrors it (no Short/Over noise).
      else counted = r.remaining;
      const overShort = Number((counted - r.remaining).toFixed(2));
      return {
        key: r.key,
        label: r.label,
        calculated: r.remaining,
        counted,
        over_short: overShort,
      };
    });
  }, [rows, cashCounted, amounts]);

  const summaryTotals = useMemo(() => {
    return summaryRows.reduce(
      (acc, r) => ({
        calculated: acc.calculated + r.calculated,
        counted: acc.counted + r.counted,
        over_short: Number((acc.over_short + r.over_short).toFixed(2)),
      }),
      { calculated: 0, counted: 0, over_short: 0 },
    );
  }, [summaryRows]);

  async function saveCounts() {
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
      // Best-effort EOD print — never blocks the close itself.
      void fetch(`/api/pos/sessions/${sessionId}/print-eod`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: summaryRows.map((r) => ({
            label: r.label,
            calculated: r.calculated,
            counted: r.counted,
            over_short: r.over_short,
          })),
          note: notes.trim() ? notes.trim() : null,
        }),
      }).catch(() => undefined);
      router.replace(`/sales/${code}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function openDrawer() {
    setError(null);
    await fetch("/api/pos/cash-drawer/kick", { method: "POST" }).catch(
      () => undefined,
    );
  }

  if (step === "summary") {
    return (
      <SummaryView
        rows={summaryRows}
        totals={summaryTotals}
        note={notes}
        onNoteChange={setNotes}
        busy={busy}
        error={error}
        onRedo={() => {
          setError(null);
          setStep("count");
        }}
        onSave={() => void saveCounts()}
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto carbon-card">
        <table className="w-full min-w-[900px] text-base text-carbon-text">
          <thead>
            <tr className="bg-[var(--carbon-surface-soft)] border-b border-carbon-border-soft text-xs uppercase tracking-wider font-bold text-carbon-text">
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Start+Adds</th>
              <th className="text-right px-4 py-3">Payments</th>
              <th className="text-right px-4 py-3">Withdraws</th>
              <th className="text-right px-4 py-3">Total Remaining</th>
              <th className="text-right px-4 py-3 min-w-[220px]">
                Closing Count
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-carbon-border-soft">
            {rows.map((r) => (
              <tr key={r.key} className="align-top">
                <td className="px-4 py-3 font-bold align-top text-carbon-text">
                  {r.label}
                </td>
                <td className="px-4 py-3 text-right tabular-nums align-top font-semibold text-carbon-text">
                  {formatMoney(r.startAdds)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums align-top font-semibold text-carbon-text">
                  {formatMoney(r.payments)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums align-top font-semibold text-carbon-text">
                  {formatMoney(r.withdraws)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums align-top font-semibold text-carbon-text">
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
                    <span className="block text-right tabular-nums text-carbon-text font-semibold">
                      {formatMoney(0)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            <tr className="bg-[var(--carbon-surface-soft)] font-bold text-carbon-text">
              <td className="px-4 py-3 text-base">Totals</td>
              <td className="px-4 py-3 text-right tabular-nums text-base">
                {formatMoney(totals.startAdds)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-base">
                {formatMoney(totals.payments)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-base">
                {formatMoney(totals.withdraws)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-base">
                {formatMoney(totals.remaining)}
              </td>
              <td className="px-4 py-3" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes */}
      <div className="mt-6">
        <label className="text-sm uppercase tracking-wider font-bold text-carbon-text mb-2 block">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Anything worth flagging on this close — over/short reasons, drawer issues, manager overrides…"
          className="carbon-input w-full p-3 text-base text-carbon-text"
        />
      </div>

      {error ? (
        <p className="text-carbon-danger mt-4 text-base">{error}</p>
      ) : null}

      {/* Buttons */}
      <div className="mt-6 flex flex-wrap gap-3 justify-end">
        <button
          type="button"
          onClick={() => void openDrawer()}
          className="carbon-btn-secondary tap px-5 font-semibold text-base"
        >
          Open Drawer
        </button>
        <Link
          href={`/sales/${code}`}
          className="carbon-btn-secondary tap px-5 font-semibold flex items-center text-base"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => setStep("summary")}
          className="carbon-btn-primary tap px-5 font-semibold text-base"
        >
          Submit Counts
        </button>
      </div>
    </>
  );
}

function SummaryView({
  rows,
  totals,
  note,
  onNoteChange,
  busy,
  error,
  onRedo,
  onSave,
}: {
  rows: Array<{
    key: string;
    label: string;
    calculated: number;
    counted: number;
    over_short: number;
  }>;
  totals: { calculated: number; counted: number; over_short: number };
  note: string;
  onNoteChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  onRedo: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <div className="overflow-x-auto carbon-card">
        <table className="w-full min-w-[700px] text-base text-carbon-text">
          <thead>
            <tr className="bg-[var(--carbon-surface-soft)] border-b border-carbon-border-soft text-xs uppercase tracking-wider font-bold text-carbon-text">
              <th className="text-left  px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Calculated</th>
              <th className="text-right px-4 py-3">Counted</th>
              <th className="text-right px-4 py-3">Short / Over</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-carbon-border-soft">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-4 py-3 font-bold text-carbon-text">
                  {r.label}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-carbon-text">
                  {formatMoney(r.calculated)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-carbon-text">
                  {formatMoney(r.counted)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums font-bold ${
                    r.over_short === 0
                      ? "text-carbon-text"
                      : r.over_short > 0
                        ? "text-emerald-700"
                        : "text-carbon-danger"
                  }`}
                >
                  {formatSigned(r.over_short)}
                </td>
              </tr>
            ))}
            <tr className="bg-[var(--carbon-surface-soft)] font-bold text-carbon-text">
              <td className="px-4 py-3 text-base">Total</td>
              <td className="px-4 py-3 text-right tabular-nums text-base">
                {formatMoney(totals.calculated)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-base">
                {formatMoney(totals.counted)}
              </td>
              <td
                className={`px-4 py-3 text-right tabular-nums text-base ${
                  totals.over_short === 0
                    ? "text-carbon-text"
                    : totals.over_short > 0
                      ? "text-emerald-700"
                      : "text-carbon-danger"
                }`}
              >
                {formatSigned(totals.over_short)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex items-start gap-3 max-w-3xl">
        <label className="text-sm uppercase tracking-wider font-bold text-carbon-text shrink-0 pt-2">
          Note
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Optional"
          className="carbon-input w-full p-3 text-base text-carbon-text"
        />
      </div>

      {error ? (
        <p className="text-carbon-danger mt-4 text-base">{error}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="carbon-btn-primary tap px-5 font-semibold text-base disabled:opacity-50 inline-flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-base">save</span>
          {busy ? "Saving…" : "Save Counts"}
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={busy}
          className="carbon-btn-secondary tap px-5 font-semibold text-base disabled:opacity-50 inline-flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-base">refresh</span>
          Redo Counts
        </button>
      </div>
      <p className="text-xs text-carbon-text-muted mt-3">
        Saving locks this session and prints the End-of-Day report on the
        receipt printer.
      </p>
    </>
  );
}

function formatSigned(n: number): string {
  if (n === 0) return formatMoney(0);
  return n > 0 ? `+${formatMoney(n)}` : `-${formatMoney(Math.abs(n))}`;
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
    <div className="grid grid-cols-[auto_auto] items-center gap-x-2 gap-y-1.5 ml-auto w-fit">
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
            className="carbon-input text-right tabular-nums w-16 h-8 px-2 text-base font-semibold text-carbon-text"
            placeholder="0"
          />
        </Row>
      ))}
      <Row label="Total">
        <span className="block text-right tabular-nums font-bold w-16 text-base text-carbon-text">
          {formatMoney(total)}
        </span>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-sm font-semibold text-carbon-text text-right whitespace-nowrap">
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
    <div className="flex items-center gap-2 ml-auto w-fit">
      <span className="text-carbon-text font-semibold text-base">$</span>
      <input
        type="number"
        step="0.01"
        min={0}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="carbon-input text-right tabular-nums w-24 h-8 px-2 text-base font-semibold text-carbon-text"
      />
    </div>
  );
}
