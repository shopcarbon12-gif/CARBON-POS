import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { storeToday } from "@/lib/reports";
import { AdminShell } from "@/components/admin/AdminShell";
import { OpenRegisterButton } from "@/components/sales/OpenRegisterButton";

/**
 * Authenticated landing page after PIN sign-in. Bento layout from the
 * stitch_luxe_cloud_pos / carbon_pos_dashboard reference, wired to live
 * data scoped to the active location:
 *
 *   - KPI row: Net sales · Avg order value · Transactions, each with a
 *     %-delta vs the previous day.
 *   - Hourly sales trend: SVG line chart (hand-rolled, no chart lib).
 *   - Top items today: per-SKU qty/revenue bar list.
 *   - Open registers: summary card for the location.
 *   - Recent activity: sales + refunds in one feed with time-ago badges.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "dashboard",
    from: `/dashboard/${code}`,
  });

  const pool = getPool();
  const locR = await pool.query(
    `SELECT id, COALESCE(timezone, 'America/New_York') AS tz
       FROM pos_locations WHERE wms_location_id = $1::uuid LIMIT 1`,
    [cashier.lid],
  );
  const loc: number | null = locR.rows[0]?.id ?? null;
  const tz: string = locR.rows[0]?.tz ?? "America/New_York";
  const today = storeToday(tz);
  const yd = new Date(`${today}T12:00:00Z`);
  yd.setUTCDate(yd.getUTCDate() - 1);
  const yesterday = yd.toISOString().slice(0, 10);
  const sold = `s.status IN ('completed','refunded')`;
  const localDay = (col: string) => `(${col} AT TIME ZONE $2)::date`;
  const userName = (a: string) =>
    `COALESCE(NULLIF(TRIM(COALESCE(${a}.first_name,'') || ' ' || COALESCE(${a}.last_name,'')), ''), ${a}.email)`;
  const P = [loc, tz, today, yesterday];

  const [salesKpiR, refundKpiR, hourlyR, hourlyRefR, topItemsR, openSessionsR, recentR] =
    await Promise.all([
      // Sales today / yesterday (store-local days). Sales later refunded
      // still count on the day sold; refunds are subtracted below.
      pool.query(
        `SELECT ${localDay("s.completed_at")}::text AS day,
                COUNT(*) AS tx, COALESCE(SUM(s.total_amount),0) AS total
           FROM pos_sales s
          WHERE s.pos_location_id = $1 AND ${sold}
            AND ${localDay("s.completed_at")} IN ($3::date, $4::date)
          GROUP BY 1`,
        P,
      ),
      pool.query(
        `SELECT ${localDay("rf.created_at")}::text AS day,
                COUNT(*) AS cnt, COALESCE(SUM(rf.amount),0) AS amount
           FROM pos_refunds rf JOIN pos_sales s ON s.id = rf.original_sale_id
          WHERE s.pos_location_id = $1
            AND ${localDay("rf.created_at")} IN ($3::date, $4::date)
          GROUP BY 1`,
        P,
      ),
      // Hourly sales, today + yesterday, store-local hours.
      pool.query(
        `SELECT ${localDay("s.completed_at")}::text AS day,
                EXTRACT(HOUR FROM s.completed_at AT TIME ZONE $2)::int AS hour,
                COALESCE(SUM(s.total_amount),0) AS total
           FROM pos_sales s
          WHERE s.pos_location_id = $1 AND ${sold}
            AND ${localDay("s.completed_at")} IN ($3::date, $4::date)
          GROUP BY 1, 2`,
        P,
      ),
      pool.query(
        `SELECT ${localDay("rf.created_at")}::text AS day,
                EXTRACT(HOUR FROM rf.created_at AT TIME ZONE $2)::int AS hour,
                COALESCE(SUM(rf.amount),0) AS total
           FROM pos_refunds rf JOIN pos_sales s ON s.id = rf.original_sale_id
          WHERE s.pos_location_id = $1
            AND ${localDay("rf.created_at")} IN ($3::date, $4::date)
          GROUP BY 1, 2`,
        P,
      ),
      // Top products today: units + net sales before tax.
      pool.query(
        `SELECT COALESCE(m.description, sl.description) AS description,
                SUM(sl.quantity)::int AS qty,
                COALESCE(SUM(sl.unit_price * sl.quantity - sl.discount_amount),0) AS revenue
           FROM pos_sale_lines sl
           JOIN pos_sales s         ON s.id = sl.sale_id
           LEFT JOIN custom_skus cs ON cs.id = sl.sku_id
           LEFT JOIN matrices m     ON m.id = cs.matrix_id
          WHERE s.pos_location_id = $1 AND ${sold}
            AND sl.line_type IN ('product','misc','gift_card')
            AND ${localDay("s.completed_at")} = $3::date
          GROUP BY 1
          ORDER BY qty DESC, revenue DESC
          LIMIT 5`,
        [loc, tz, today],
      ),
      // Open registers with what they've taken so far and the cash that
      // should be in the drawer now (same formula as Close Register).
      pool.query(
        `SELECT ss.id, r.name AS register_name, ss.opening_cash, ss.opened_at,
                ${userName("u")} AS opened_by,
                (SELECT COUNT(*) FROM pos_sales x
                  WHERE x.register_id = ss.register_id AND x.created_at >= ss.opened_at
                    AND x.status IN ('completed','refunded')) AS sales_count,
                (SELECT COALESCE(SUM(x.total_amount),0) FROM pos_sales x
                  WHERE x.register_id = ss.register_id AND x.created_at >= ss.opened_at
                    AND x.status IN ('completed','refunded')) AS sales_total,
                ss.opening_cash
                + (SELECT COALESCE(SUM(p.amount),0) FROM pos_payments p JOIN pos_sales x ON x.id = p.sale_id
                    WHERE x.register_id = ss.register_id AND x.created_at >= ss.opened_at
                      AND p.method = 'cash' AND p.status = 'completed')
                + (SELECT COALESCE(SUM(CASE WHEN type = 'add' THEN amount ELSE -amount END),0)
                     FROM pos_cash_movements WHERE register_session_id = ss.id)
                - (SELECT COALESCE(SUM(amount),0) FROM pos_refunds
                    WHERE register_session_id = ss.id AND method = 'cash') AS expected_cash
           FROM pos_register_sessions ss
           JOIN pos_registers r ON r.id = ss.register_id
           JOIN users u         ON u.id = ss.opened_by
          WHERE ss.status = 'open' AND r.pos_location_id = $1
          ORDER BY ss.opened_at`,
        [loc],
      ),
      // Recent activity — sales (incl. later-refunded) and refunds.
      pool.query(
        `SELECT * FROM (
           SELECT 'sale'::text AS kind, s.id AS id, s.id AS sale_id, s.sale_number,
                  s.total_amount, s.status,
                  COALESCE(s.completed_at, s.created_at) AS happened_at
             FROM pos_sales s
            WHERE s.status IN ('completed','refunded','voided') AND s.pos_location_id = $1
           UNION ALL
           SELECT 'refund'::text, rf.id, s.id, s.sale_number, rf.amount, rf.method,
                  rf.created_at
             FROM pos_refunds rf JOIN pos_sales s ON s.id = rf.original_sale_id
            WHERE s.pos_location_id = $1
         ) feed
         ORDER BY happened_at DESC NULLS LAST
         LIMIT 12`,
        [loc],
      ),
    ]);

  const byDay = <T,>(rows: Array<Record<string, unknown>>, day: string, f: (r: Record<string, unknown>) => T, d: T) => {
    const r = rows.find((x) => x.day === day);
    return r ? f(r) : d;
  };
  const kpi = (day: string) => {
    const tx = byDay(salesKpiR.rows, day, (r) => Number(r.tx), 0);
    const gross = byDay(salesKpiR.rows, day, (r) => Number(r.total), 0);
    const refunds = byDay(refundKpiR.rows, day, (r) => Number(r.amount), 0);
    const refundCnt = byDay(refundKpiR.rows, day, (r) => Number(r.cnt), 0);
    return { tx, gross, refunds, refundCnt, net: gross - refunds, aov: tx ? gross / tx : 0 };
  };
  const kT = kpi(today);
  const kY = kpi(yesterday);

  const hourlyFor = (day: string) => {
    const h = new Array(24).fill(0) as number[];
    for (const r of hourlyR.rows) if (r.day === day) h[Number(r.hour)] += Number(r.total);
    for (const r of hourlyRefR.rows) if (r.day === day) h[Number(r.hour)] -= Number(r.total);
    return h.map((total, hour) => ({ hour, total: Math.round(total * 100) / 100 }));
  };
  const hourly = hourlyFor(today);
  const hourlyPrev = hourlyFor(yesterday);
  const hourlyMax = Math.max(1, ...hourly.map((p) => p.total), ...hourlyPrev.map((p) => p.total));

  const topItems = topItemsR.rows as Array<{
    description: string;
    qty: number;
    revenue: string;
  }>;
  const topQtyMax = Math.max(1, ...topItems.map((r) => Number(r.qty)));

  const openSessions = openSessionsR.rows as Array<{
    id: number;
    register_name: string;
    opening_cash: string;
    opened_at: string;
    opened_by: string;
    sales_count: string;
    sales_total: string;
    expected_cash: string;
  }>;
  const recent = recentR.rows as Array<{
    kind: "sale" | "refund";
    id: number;
    sale_id: number;
    sale_number: string;
    total_amount: string;
    status: string;
    happened_at: string;
  }>;

  const todayLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeIn = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

  return (
    <AdminShell email={cashier.email} active="dashboard" code={code}>
      <main className="p-3 sm:p-6 lg:p-10">
        <div className="max-w-[1440px] mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-wrap justify-between items-end gap-3 mb-2">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-carbon-text">
                Daily Overview
              </h1>
              <p className="text-base text-carbon-text-muted mt-1">
                Today&apos;s performance at this store, in store time.
              </p>
            </div>
            <div className="flex items-center gap-2 text-carbon-blue text-[11px] uppercase tracking-wider font-bold">
              <span className="material-symbols-outlined text-sm">calendar_today</span>
              <span>{todayLabel}</span>
            </div>
          </div>

          {/* KPI bento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            <KpiCard
              label="Net Sales"
              icon="payments"
              value={formatMoney(kT.net)}
              delta={pctDelta(kT.net, kY.net)}
              sub="sales − refunds · vs. yesterday"
              accentBar
            />
            <KpiCard
              label="Average Order Value"
              icon="shopping_bag"
              value={formatMoney(kT.aov)}
              delta={pctDelta(kT.aov, kY.aov)}
            />
            <KpiCard
              label="Transactions"
              icon="receipt_long"
              value={String(kT.tx)}
              delta={pctDelta(kT.tx, kY.tx)}
            />
            <KpiCard
              label="Refunds"
              icon="assignment_return"
              value={kT.refunds > 0 ? `-${formatMoney(kT.refunds)}` : formatMoney(0)}
              delta={pctDelta(kT.refunds, kY.refunds)}
              sub={`${kT.refundCnt} refund${kT.refundCnt === 1 ? "" : "s"} today · vs. yesterday`}
              invert
            />
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left two columns */}
            <div className="lg:col-span-2 space-y-5">
              {/* Hourly Sales Trend */}
              <div className="carbon-card p-5">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-base font-semibold">Hourly Sales Trend</h3>
                  <Link
                    href={`/reports/${code}/end-of-day?from=${today}&to=${today}`}
                    className="text-[11px] uppercase tracking-wider font-bold text-carbon-blue border border-carbon-blue px-3 py-1 hover:bg-[var(--carbon-blue-soft)] transition-colors"
                  >
                    Export
                  </Link>
                </div>
                <HourlyChart points={hourly} prev={hourlyPrev} max={hourlyMax} />
                <div className="flex gap-5 mt-4 text-xs text-carbon-text-muted">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-5 h-0.5 bg-carbon-blue" /> Today (net of refunds)
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-5 border-t border-dashed border-carbon-text-muted" /> Yesterday
                  </span>
                </div>
              </div>

              {/* Top Items + Open Registers */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="carbon-card p-5">
                  <h3 className="text-base font-semibold mb-4">Top items today</h3>
                  {topItems.length === 0 ? (
                    <p className="text-sm text-carbon-text-muted">
                      No sales yet today.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {topItems.map((row) => (
                        <div key={row.description}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-carbon-text truncate pr-3">
                              {row.description}
                            </span>
                            <span className="font-mono text-carbon-blue tabular-nums">
                              {row.qty} ·{" "}
                              <span className="text-carbon-text-muted">
                                {formatMoney(row.revenue)}
                              </span>
                            </span>
                          </div>
                          <div className="w-full bg-[var(--carbon-surface-soft)] h-2">
                            <div
                              className="bg-carbon-blue h-full"
                              style={{
                                width: `${Math.max(4, (Number(row.qty) / topQtyMax) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="carbon-card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold">Open registers</h3>
                    <Link
                      href={`/sales/${code}`}
                      className="text-[11px] uppercase tracking-wider font-bold text-carbon-blue hover:underline"
                    >
                      Manage →
                    </Link>
                  </div>
                  {openSessions.length === 0 ? (
                    <div className="text-sm text-carbon-text-muted">
                      <p>No registers are open right now.</p>
                      {/* Renders the same client-side denomination dialog
                          as the Sales tab — single click opens the popup
                          directly here, no detour through /sales/{code}. */}
                      <div className="mt-3">
                        <OpenRegisterButton code={code} />
                      </div>
                    </div>
                  ) : (
                    <ul className="divide-y divide-carbon-border-soft">
                      {openSessions.map((s) => (
                        <li key={s.id} className="py-3">
                          <div className="flex justify-between gap-3">
                            <p className="font-semibold truncate">{s.register_name}</p>
                            <p className="text-right font-mono tabular-nums shrink-0">
                              {formatMoney(s.sales_total)}
                            </p>
                          </div>
                          <div className="flex justify-between gap-3 text-xs text-carbon-text-muted">
                            <span className="truncate">
                              {s.opened_by} · opened {timeIn(s.opened_at)}
                            </span>
                            <span className="shrink-0">
                              {Number(s.sales_count)} sale{Number(s.sales_count) === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="flex justify-between gap-3 text-xs mt-1">
                            <span className="text-carbon-text-muted">
                              Opened with {formatMoney(s.opening_cash)}
                            </span>
                            <span className="font-semibold">
                              Cash in drawer {formatMoney(s.expected_cash)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Right column — Recent Activity */}
            <div className="carbon-card flex flex-col max-h-[800px]">
              <div className="p-5 border-b border-carbon-border-soft flex justify-between items-center">
                <h3 className="text-base font-semibold">Recent Activity</h3>
                <span className="material-symbols-outlined text-carbon-text-muted">
                  history
                </span>
              </div>
              <div className="overflow-y-auto flex-1 px-5">
                {recent.length === 0 ? (
                  <p className="text-sm text-carbon-text-muted py-5">
                    No activity yet.
                  </p>
                ) : (
                  recent.map((row) => (
                    <ActivityRow
                      key={`${row.kind}-${row.id}`}
                      row={row}
                      code={code}
                      time={timeIn(row.happened_at)}
                    />
                  ))
                )}
              </div>
              <div className="p-4 border-t border-carbon-border-soft">
                <Link
                  href={`/sales/${code}`}
                  className="carbon-btn-secondary tap w-full flex items-center justify-center text-[11px] font-bold uppercase tracking-wider"
                >
                  View all transactions
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Subcomponents                                                              */
/* -------------------------------------------------------------------------- */

function KpiCard({
  label,
  icon,
  value,
  delta,
  sub = "vs. yesterday",
  accentBar,
  invert,
}: {
  label: string;
  icon: string;
  value: string;
  /** Signed pct vs previous period. null when no baseline (e.g. yesterday=0). */
  delta: number | null;
  sub?: string;
  accentBar?: boolean;
  /** For refunds: going up is bad, so colour the arrow the other way. */
  invert?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  const positive = invert ? !up : up;
  return (
    <div className="carbon-card p-6 relative overflow-hidden">
      {accentBar ? (
        <div className="absolute top-0 left-0 w-1 h-full bg-carbon-blue" />
      ) : null}
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted">
          {label}
        </h3>
        <span className="material-symbols-outlined text-carbon-text-muted">
          {icon}
        </span>
      </div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="total-display text-4xl">{value}</span>
        {delta !== null ? (
          <span
            className={`font-mono text-sm flex items-center ${
              positive ? "text-carbon-blue" : "text-carbon-danger"
            }`}
          >
            <span className="material-symbols-outlined text-base">
              {up ? "arrow_upward" : "arrow_downward"}
            </span>
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : (
          <span className="font-mono text-sm text-carbon-text-muted">—</span>
        )}
      </div>
      <p className="text-xs text-carbon-text-muted mt-2">{sub}</p>
    </div>
  );
}

function HourlyChart({
  points,
  prev,
  max,
}: {
  points: Array<{ hour: number; total: number }>;
  prev: Array<{ hour: number; total: number }>;
  max: number;
}) {
  // Map each point to the SVG viewBox 0..100 in x and 0..100 in y (inverted).
  const toPath = (pts: Array<{ total: number }>) =>
    pts
      .map((p, i) => {
        const x = (i / (pts.length - 1)) * 100;
        const y = 100 - (Math.max(0, p.total) / max) * 90;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  // Tick labels every 3 hours: 0,3,6,...,21.
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21];
  return (
    <div className="h-64 w-full relative border-b border-l border-carbon-border-soft pl-10 pb-6">
      <div className="absolute -left-1 top-0 h-[calc(100%-1.5rem)] flex flex-col justify-between text-carbon-text-muted font-mono text-[10px]">
        <span>{formatAxis(max)}</span>
        <span>{formatAxis(max * 0.66)}</span>
        <span>{formatAxis(max * 0.33)}</span>
        <span>$0</span>
      </div>
      <svg
        className="w-full h-full overflow-visible"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        {[25, 50, 75].map((y) => (
          <line
            key={y}
            x1={0}
            x2={100}
            y1={y}
            y2={y}
            stroke="var(--carbon-border-soft)"
            strokeDasharray="2,2"
            strokeWidth={0.5}
          />
        ))}
        <path
          d={toPath(prev)}
          fill="none"
          stroke="var(--carbon-text-muted, #888)"
          strokeWidth={1.25}
          strokeDasharray="4,3"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={toPath(points)}
          fill="none"
          stroke="var(--carbon-blue)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) =>
          p.total !== 0 ? (
            <circle
              key={p.hour}
              cx={(i / (points.length - 1)) * 100}
              cy={100 - (Math.max(0, p.total) / max) * 90}
              r={1.2}
              fill="var(--carbon-blue)"
            >
              <title>{`${labelHour(p.hour)}: ${formatMoney(p.total)} today, ${formatMoney(prev[i]?.total ?? 0)} yesterday`}</title>
            </circle>
          ) : null,
        )}
      </svg>
      <div className="absolute -bottom-1 left-10 right-0 flex justify-between text-carbon-text-muted font-mono text-[10px]">
        {ticks.map((t) => (
          <span key={t}>{labelHour(t)}</span>
        ))}
      </div>
    </div>
  );
}

function ActivityRow({
  row,
  code,
  time,
}: {
  row: {
    kind: "sale" | "refund";
    id: number;
    sale_id: number;
    sale_number: string;
    total_amount: string;
    status: string;
    happened_at: string;
  };
  code: string;
  time: string;
}) {
  const isRefund = row.kind === "refund";
  const isVoided = !isRefund && row.status === "voided";
  const wasRefunded = !isRefund && row.status === "refunded";
  const icon = isRefund ? "assignment_return" : isVoided ? "cancel" : "check_circle";
  const iconClass = isRefund
    ? "text-carbon-danger"
    : isVoided
      ? "text-carbon-danger"
      : "text-carbon-blue";
  const amountClass = isRefund
    ? "text-carbon-danger"
    : isVoided
      ? "text-carbon-text-muted line-through"
      : "text-carbon-text";
  const REFUND_TO: Record<string, string> = {
    original_card: "to card",
    cash: "cash",
    store_credit: "store credit",
    exchange: "exchange",
  };
  const verb = isRefund
    ? `Refund (${REFUND_TO[row.status] ?? row.status}) for`
    : isVoided
      ? "Sale voided"
      : wasRefunded
        ? "Sale (refunded)"
        : "Sale completed";
  const href = isRefund
    ? `/sales/${code}/refund/receipt?refund=${row.id}&back=${encodeURIComponent(`/dashboard/${code}`)}`
    : `/sales/${code}/${row.sale_id}`;

  return (
    <Link
      href={href}
      className="flex items-start gap-3 py-3 border-b border-carbon-border-soft last:border-0 hover:bg-carbon-bg transition-colors"
    >
      <div className="w-8 h-8 bg-[var(--carbon-surface-soft)] flex items-center justify-center flex-shrink-0">
        <span className={`material-symbols-outlined text-sm ${iconClass}`}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-carbon-text truncate">
          {verb} <span className="font-mono text-carbon-blue">#{row.sale_number}</span>
        </p>
        <p className="text-[11px] text-carbon-text-muted uppercase tracking-wider font-bold">
          {timeAgo(row.happened_at)} · {time}
        </p>
      </div>
      <p className={`font-mono font-semibold tabular-nums shrink-0 ${amountClass}`}>
        {isRefund ? "-" : ""}
        {formatMoney(row.total_amount)}
      </p>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function formatAxis(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

function labelHour(h: number): string {
  if (h === 0) return "12A";
  if (h === 12) return "12P";
  if (h < 12) return `${h}A`;
  return `${h - 12}P`;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
