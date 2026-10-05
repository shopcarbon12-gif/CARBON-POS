"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { ACTIVITY_LABEL } from "@/components/pos/RegisterReportView";
import type { RegisterReport } from "@/lib/register-report-types";

/**
 * First step of Close Register: everything that happened on this shift
 * (totals, payments, cash drawer math and a full activity timeline) so
 * the cashier/manager can review it before counting the drawer. The
 * same data prints on the End of Day report once the close is saved.
 */
export function ShiftReview({
  sessionId,
  code,
  onApprove,
}: {
  sessionId: number;
  code: string;
  onApprove: () => void;
}) {
  const [report, setReport] = useState<RegisterReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/pos/sessions/${sessionId}/report`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as RegisterReport;
      })
      .then(setReport)
      .catch(() => setError("Couldn't load the shift activity."));
  }, [sessionId]);

  if (error) return <p className="text-carbon-danger">{error}</p>;
  if (!report) return <p className="text-carbon-text-muted">Loading shift activity…</p>;

  const s = report.session;
  const e = report.eod;
  const tz = s.timezone;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    });
  const paymentsTotal = e.payments.reduce((a, p) => a + p.amount, 0);

  return (
    <>
      <p className="text-sm text-carbon-text-muted mb-4">
        Opened{" "}
        <span className="font-semibold text-carbon-text">
          {new Date(s.opened_at).toLocaleString("en-US", {
            timeZone: tz,
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>{" "}
        by <span className="font-semibold text-carbon-text">{s.opened_by_name}</span>{" "}
        with {formatMoney(s.opening_cash)}. Review the shift, then approve to
        count the drawer.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile label="Transactions" value={String(e.sales_count)} sub={`${e.items_sold} items · ${e.voided_count} voided`} />
        <Tile label="Total sales" value={formatMoney(e.total)} sub={`Tax ${formatMoney(e.tax)} · Disc. ${formatMoney(e.discounts)}`} />
        <Tile label="Refunds" value={formatMoney(e.refunds.total)} sub={`${e.refunds.count} refund${e.refunds.count === 1 ? "" : "s"}`} />
        <Tile label="Expected cash" value={formatMoney(e.cash.expected)} sub="in the drawer now" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <div className="carbon-card p-4">
          <h3 className="text-xs uppercase tracking-wider font-bold mb-2">Payments</h3>
          {e.payments.length === 0 && <p className="text-sm text-carbon-text-muted">No payments.</p>}
          {e.payments.map((p) => (
            <Line key={p.method} k={`${p.label} (${p.count})`} v={formatMoney(p.amount)} />
          ))}
          <Line k="Total" v={formatMoney(paymentsTotal)} bold />
          {e.refunds.by_method.length > 0 && (
            <>
              <h3 className="text-xs uppercase tracking-wider font-bold mt-4 mb-2">Refunds</h3>
              {e.refunds.by_method.map((r) => (
                <Line key={r.method} k={r.label} v={`-${formatMoney(r.amount)}`} />
              ))}
            </>
          )}
        </div>
        <div className="carbon-card p-4">
          <h3 className="text-xs uppercase tracking-wider font-bold mb-2">Cash drawer</h3>
          <Line k="Opening cash" v={formatMoney(e.cash.opening)} />
          <Line k="+ Cash sales" v={formatMoney(e.cash.cash_sales)} />
          <Line k="+ Cash added" v={formatMoney(e.cash.adds)} />
          <Line k="− Drops" v={`-${formatMoney(e.cash.drops)}`} />
          <Line k="− Payouts" v={`-${formatMoney(e.cash.payouts)}`} />
          <Line k="− Cash refunds" v={`-${formatMoney(e.cash.cash_refunds)}`} />
          <Line k="Expected cash" v={formatMoney(e.cash.expected)} bold />
        </div>
      </div>

      <div className="overflow-x-auto carbon-card">
        <table className="w-full min-w-[760px] text-sm text-carbon-text">
          <thead>
            <tr className="bg-[var(--carbon-surface-soft)] border-b border-carbon-border-soft text-xs uppercase tracking-wider font-bold">
              <th className="text-left px-4 py-3">Time</th>
              <th className="text-left px-4 py-3">Activity</th>
              <th className="text-left px-4 py-3">Receipt #</th>
              <th className="text-left px-4 py-3">Details</th>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-right px-4 py-3">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-carbon-border-soft">
            {e.activity.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-carbon-text-muted">
                  No activity on this shift.
                </td>
              </tr>
            ) : (
              e.activity.map((a, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">{time(a.at)}</td>
                  <td className="px-4 py-2 font-semibold">{ACTIVITY_LABEL[a.type]}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {a.sale_id ? (
                      <Link href={`/sales/${code}/${a.sale_id}`} className="text-carbon-blue hover:underline">
                        {a.ref}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2">{a.detail || "—"}</td>
                  <td className="px-4 py-2">{a.by || "—"}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums font-semibold ${
                      a.amount < 0 ? "text-carbon-danger" : ""
                    }`}
                  >
                    {a.type === "void"
                      ? "Voided"
                      : a.amount < 0
                        ? `-${formatMoney(-a.amount)}`
                        : formatMoney(a.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 justify-end">
        <Link
          href={`/sales/${code}`}
          className="carbon-btn-secondary tap px-5 font-semibold flex items-center text-base"
        >
          Back to Sales
        </Link>
        <button
          type="button"
          onClick={onApprove}
          className="carbon-btn-primary tap px-5 font-semibold text-base inline-flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-base">task_alt</span>
          Approve &amp; Count Drawer
        </button>
      </div>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="carbon-card p-4">
      <p className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      <p className="text-xs text-carbon-text-muted mt-1">{sub}</p>
    </div>
  );
}

function Line({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div
      className={`flex justify-between text-sm py-0.5 ${
        bold ? "font-bold border-t border-carbon-border-soft mt-1 pt-1" : ""
      }`}
    >
      <span>{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
