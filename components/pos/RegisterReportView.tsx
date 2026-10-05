"use client";

import type { CSSProperties, ReactNode } from "react";
import { formatMoney } from "@/lib/utils";
import {
  DENOM_VALUES,
  type ActivityRow,
  type Denoms,
  type RegisterReport,
} from "@/lib/register-report-types";

/**
 * Thermal-paper layout for the Register Open report and the End-of-Day
 * report. Same 3 1/8" width + Arial styling as ReceiptView so it can be
 * rasterized by lib/epos-print and printed on the TM-m30II. The ref'd
 * element for printing is the inner <main>.
 */
export function RegisterReportView({
  report,
  kind,
}: {
  report: RegisterReport;
  kind: "open" | "eod";
}) {
  const s = report.session;
  const tz = s.timezone;
  const cityLine = [s.city, s.state, s.zip].filter(Boolean).join(", ");

  return (
    <div style={S.page}>
      <main style={S.receipt}>
        <header style={S.center}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="Carbon logo" style={S.logo} />
          <div style={S.address}>
            {s.address_line1 && (
              <>
                {s.address_line1}
                <br />
              </>
            )}
            {s.address_line2 && (
              <>
                {s.address_line2}
                <br />
              </>
            )}
            {cityLine && (
              <>
                {cityLine}
                <br />
              </>
            )}
            {s.phone}
          </div>
          <div style={S.title}>
            {kind === "open" ? "REGISTER OPEN REPORT" : "END OF DAY REPORT"}
          </div>
        </header>

        <Section>
          <KV k="Store" v={s.location_name} />
          <KV k="Register" v={s.register_name} />
          <KV k="Session #" v={String(s.id)} />
          {kind === "open" ? (
            <>
              <KV k="Date" v={fmtDate(s.opened_at, tz)} />
              <KV k="Time" v={fmtTime(s.opened_at, tz)} />
              <KV k="User" v={s.opened_by_name} />
            </>
          ) : (
            <>
              <KV k="Opened" v={fmtDateTime(s.opened_at, tz)} />
              <KV k="Opened by" v={s.opened_by_name} />
              <KV
                k="Closed"
                v={s.closed_at ? fmtDateTime(s.closed_at, tz) : "STILL OPEN"}
              />
              {s.closed_by_name && <KV k="Closed by" v={s.closed_by_name} />}
            </>
          )}
        </Section>

        {kind === "open" ? <OpenBody report={report} /> : <EodBody report={report} />}
      </main>
    </div>
  );
}

function OpenBody({ report }: { report: RegisterReport }) {
  const s = report.session;
  return (
    <>
      <Section title="Opening Cash Count">
        {s.opening_denoms ? (
          <DenomTable denoms={s.opening_denoms} />
        ) : (
          <p style={S.muted}>No bill breakdown recorded.</p>
        )}
        <TotalRow k="TOTAL CASH" v={formatMoney(s.opening_cash)} />
      </Section>
    </>
  );
}

function EodBody({ report }: { report: RegisterReport }) {
  const s = report.session;
  const e = report.eod;
  const paymentsTotal = e.payments.reduce((a, p) => a + p.amount, 0);
  return (
    <>
      <Section title="Sales Summary">
        <KV k="Transactions" v={String(e.sales_count)} />
        <KV k="Items sold" v={String(e.items_sold)} />
        <KV k="Voided sales" v={String(e.voided_count)} />
        {e.first_sale_number && (
          <>
            <KV k="First receipt" v={e.first_sale_number} />
            <KV k="Last receipt" v={e.last_sale_number ?? ""} />
          </>
        )}
        <KV k="Gross sales" v={formatMoney(e.gross)} />
        <KV k="Discounts" v={neg(e.discounts)} />
        <KV k="Tax" v={formatMoney(e.tax)} />
        <TotalRow k="TOTAL SALES" v={formatMoney(e.total)} />
        {e.sales_count > 0 && (
          <KV k="Avg. sale" v={formatMoney(e.total / e.sales_count)} />
        )}
      </Section>

      <Section title="Payments">
        {e.payments.length === 0 && <p style={S.muted}>No payments.</p>}
        {e.payments.map((p) => (
          <KV key={p.method} k={`${p.label} (${p.count})`} v={formatMoney(p.amount)} />
        ))}
        <TotalRow k="TOTAL PAYMENTS" v={formatMoney(paymentsTotal)} />
      </Section>

      <Section title="Refunds">
        {e.refunds.by_method.length === 0 && <p style={S.muted}>No refunds.</p>}
        {e.refunds.by_method.map((r) => (
          <KV key={r.method} k={r.label} v={neg(r.amount)} />
        ))}
        <TotalRow
          k={`TOTAL REFUNDS (${e.refunds.count})`}
          v={neg(e.refunds.total)}
        />
      </Section>

      <Section title="Cash Drawer">
        <KV k="Opening cash" v={formatMoney(e.cash.opening)} />
        <KV k="+ Cash sales" v={formatMoney(e.cash.cash_sales)} />
        <KV k="+ Cash added" v={formatMoney(e.cash.adds)} />
        <KV k="− Drops" v={neg(e.cash.drops)} />
        <KV k="− Payouts" v={neg(e.cash.payouts)} />
        <KV k="− Cash refunds" v={neg(e.cash.cash_refunds)} />
        <TotalRow
          k="EXPECTED CASH"
          v={formatMoney(s.expected_cash ?? e.cash.expected)}
        />
        {s.closing_cash_counted != null && (
          <>
            <KV k="Counted cash" v={formatMoney(s.closing_cash_counted)} />
            <TotalRow
              k={(s.cash_over_short ?? 0) < 0 ? "SHORT" : "OVER / SHORT"}
              v={signed(s.cash_over_short ?? 0)}
            />
          </>
        )}
      </Section>

      {s.closing_denoms && (
        <Section title="Closing Cash Count">
          <DenomTable denoms={s.closing_denoms} />
        </Section>
      )}

      {s.closing_counts && s.closing_counts.length > 0 && (
        <Section title="Count Summary">
          <div style={{ ...S.grid4, ...S.gridHead }}>
            <span>Type</span>
            <span style={S.r}>Calc</span>
            <span style={S.r}>Count</span>
            <span style={S.r}>+/−</span>
          </div>
          {s.closing_counts.map((r) => (
            <div key={r.key} style={S.grid4}>
              <span>{r.label}</span>
              <span style={S.r}>{money0(r.calculated)}</span>
              <span style={S.r}>{money0(r.counted)}</span>
              <span style={S.r}>{signed(r.over_short, true)}</span>
            </div>
          ))}
        </Section>
      )}

      {e.activity.length > 0 && (
        <Section title={`Shift Activity (${e.activity.length})`}>
          {e.activity.map((a, i) => (
            <div key={i} style={S.activityRow}>
              <KV
                k={`${fmtTime(a.at, s.timezone)} ${ACTIVITY_LABEL[a.type]}${
                  a.ref ? ` ${a.ref}` : ""
                }`}
                v={a.type === "void" ? "VOID" : signedMoney(a.amount)}
              />
              {(a.detail || a.by) && (
                <div style={S.small}>
                  {[a.detail, a.by].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {e.by_employee.length > 0 && (
        <Section title="Sales by Employee">
          {e.by_employee.map((r) => (
            <KV key={r.name} k={`${r.name} (${r.count})`} v={formatMoney(r.total)} />
          ))}
        </Section>
      )}

      {s.close_note && (
        <Section title="Note">
          <div style={{ whiteSpace: "pre-wrap" }}>{s.close_note}</div>
        </Section>
      )}
    </>
  );
}

export const ACTIVITY_LABEL: Record<ActivityRow["type"], string> = {
  sale: "Sale",
  void: "Void",
  refund: "Refund",
  add: "Cash add",
  drop: "Drop",
  payout: "Payout",
};

function signedMoney(x: number): string {
  return x < 0 ? neg(x) : formatMoney(x);
}

function DenomTable({ denoms }: { denoms: Denoms }) {
  let bills = 0;
  let total = 0;
  const rows = DENOM_VALUES.map((v) => {
    const qty = Number(denoms[String(v)] ?? 0) || 0;
    bills += qty;
    total += qty * v;
    return { v, qty };
  });
  return (
    <>
      <div style={{ ...S.grid3, ...S.gridHead }}>
        <span>Bill</span>
        <span style={S.r}>Qty</span>
        <span style={S.r}>Amount</span>
      </div>
      {rows.map((r) => (
        <div key={r.v} style={S.grid3}>
          <span>${r.v}</span>
          <span style={S.r}>{r.qty}</span>
          <span style={S.r}>{formatMoney(r.qty * r.v)}</span>
        </div>
      ))}
      <div style={{ ...S.grid3, fontWeight: 800 }}>
        <span>Bills</span>
        <span style={S.r}>{bills}</span>
        <span style={S.r}>{formatMoney(total)}</span>
      </div>
    </>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section style={S.section}>
      {title && <div style={S.sectionTitle}>{title}</div>}
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={S.kv}>
      <span>{k}</span>
      <span style={S.kvVal}>{v}</span>
    </div>
  );
}

function TotalRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ ...S.kv, ...S.total }}>
      <span>{k}</span>
      <span style={S.kvVal}>{v}</span>
    </div>
  );
}

function neg(x: number): string {
  return x === 0 ? formatMoney(0) : `-${formatMoney(Math.abs(x))}`;
}

function signed(x: number, short = false): string {
  const f = short ? money0 : formatMoney;
  if (Math.abs(x) < 0.005) return f(0);
  return x > 0 ? `+${f(x)}` : `-${f(Math.abs(x))}`;
}

/** Compact money for the narrow 4-column table. */
function money0(x: number): string {
  return formatMoney(x).replace(/\.00$/, "");
}

function fmtDate(iso: string, tz: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDateTime(iso: string, tz: string) {
  return `${fmtDate(iso, tz)} ${fmtTime(iso, tz)}`;
}

const FONT = "Arial, Helvetica, sans-serif";

const S: Record<string, CSSProperties> = {
  page: {
    background: "#e9e9e9",
    padding: 24,
    display: "flex",
    justifyContent: "center",
    color: "#000",
    fontFamily: FONT,
  },
  receipt: {
    width: "3.125in",
    background: "#fff",
    padding: "6mm 4mm 5mm",
    boxShadow: "0 8px 28px rgba(0,0,0,.16)",
    fontSize: 14,
    lineHeight: 1.25,
    boxSizing: "border-box",
    color: "#000",
  },
  center: { textAlign: "center" },
  logo: {
    width: "52mm",
    maxWidth: "100%",
    height: "auto",
    display: "block",
    margin: "0 auto 1.5mm",
  },
  address: { fontSize: 13, lineHeight: 1.15 },
  title: {
    marginTop: "4mm",
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: ".25px",
  },
  section: {
    marginTop: "4mm",
    paddingTop: "2mm",
    borderTop: "1px dashed #000",
  },
  sectionTitle: {
    fontWeight: 800,
    fontSize: 14,
    textTransform: "uppercase",
    marginBottom: "1.5mm",
  },
  kv: {
    display: "flex",
    justifyContent: "space-between",
    gap: "2mm",
    fontSize: 13,
    lineHeight: 1.35,
  },
  kvVal: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  total: {
    fontWeight: 800,
    fontSize: 14,
    borderTop: "1px solid #000",
    marginTop: "1mm",
    paddingTop: ".8mm",
  },
  grid3: {
    display: "grid",
    gridTemplateColumns: "1fr 12mm 24mm",
    fontSize: 13,
    lineHeight: 1.35,
  },
  grid4: {
    display: "grid",
    gridTemplateColumns: "1fr 15mm 15mm 14mm",
    fontSize: 12,
    lineHeight: 1.35,
  },
  gridHead: { fontWeight: 800, borderBottom: "1px solid #000" },
  r: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  muted: { fontSize: 12, margin: 0 },
  small: { fontSize: 11, lineHeight: 1.2 },
  activityRow: { marginBottom: "1mm" },
};
