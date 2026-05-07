import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { AdminShell } from "@/components/admin/AdminShell";

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
  const [kpiR, hourlyR, topItemsR, openSessionsR, recentR] = await Promise.all([
    // KPIs for today vs yesterday in one round-trip.
    pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN s.completed_at::date = current_date THEN s.total_amount END), 0)        AS today_rev,
         COALESCE(SUM(CASE WHEN s.completed_at::date = current_date - 1 THEN s.total_amount END), 0)    AS yest_rev,
         COUNT(*) FILTER (WHERE s.completed_at::date = current_date)                                    AS today_tx,
         COUNT(*) FILTER (WHERE s.completed_at::date = current_date - 1)                                AS yest_tx
       FROM pos_sales s
       WHERE s.status = 'completed'
         AND s.completed_at::date BETWEEN current_date - 1 AND current_date
         AND s.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid)`,
      [cashier.lid],
    ),
    // Hourly sales for today (0..23). We aggregate server-side and pad
    // missing hours to 0 in JS so the SVG always renders 24 buckets.
    pool.query(
      `SELECT EXTRACT(HOUR FROM s.completed_at)::int AS hour,
              COALESCE(SUM(s.total_amount), 0)::numeric AS total
         FROM pos_sales s
        WHERE s.status = 'completed'
          AND s.completed_at::date = current_date
          AND s.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid)
        GROUP BY hour
        ORDER BY hour`,
      [cashier.lid],
    ),
    // Top items today by quantity sold.
    pool.query(
      `SELECT sl.description,
              SUM(sl.quantity)::int  AS qty,
              SUM(sl.line_total)::numeric AS revenue
         FROM pos_sale_lines sl
         JOIN pos_sales s ON s.id = sl.sale_id
        WHERE s.status = 'completed'
          AND s.completed_at::date = current_date
          AND s.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid)
        GROUP BY sl.description
        ORDER BY qty DESC, revenue DESC
        LIMIT 5`,
      [cashier.lid],
    ),
    // Currently-open register sessions at this location.
    pool.query(
      `SELECT s.id, r.name AS register_name, s.opening_cash, s.opened_at,
              u.email AS opened_by_email
         FROM pos_register_sessions s
         JOIN pos_registers r ON r.id = s.register_id
         JOIN users u         ON u.id = s.opened_by
        WHERE s.status = 'open'
          AND r.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid)
        ORDER BY s.opened_at`,
      [cashier.lid],
    ),
    // Recent activity — sales and refunds in one ordered list. Each row is
    // tagged with its kind so the feed renderer picks the right icon and sign.
    pool.query(
      `SELECT * FROM (
         SELECT 'sale'::text AS kind,
                s.id::text   AS id,
                s.sale_number,
                s.total_amount,
                s.status,
                COALESCE(s.completed_at, s.created_at) AS happened_at,
                NULL::text   AS reason
           FROM pos_sales s
          WHERE s.status IN ('completed','voided')
            AND s.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid)
         UNION ALL
         SELECT 'refund'::text AS kind,
                rf.id::text    AS id,
                s.sale_number,
                rf.amount      AS total_amount,
                'refunded'     AS status,
                rf.created_at  AS happened_at,
                rf.reason
           FROM pos_refunds rf
           JOIN pos_sales s ON s.id = rf.original_sale_id
          WHERE s.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid)
       ) feed
       ORDER BY happened_at DESC NULLS LAST
       LIMIT 12`,
      [cashier.lid],
    ),
  ]);

  const k = kpiR.rows[0];
  const todayRev = Number(k.today_rev ?? 0);
  const yestRev = Number(k.yest_rev ?? 0);
  const todayTx = Number(k.today_tx ?? 0);
  const yestTx = Number(k.yest_tx ?? 0);
  const todayAov = todayTx > 0 ? todayRev / todayTx : 0;
  const yestAov = yestTx > 0 ? yestRev / yestTx : 0;

  const hourlyByHour = new Map<number, number>();
  for (const row of hourlyR.rows) {
    hourlyByHour.set(Number(row.hour), Number(row.total));
  }
  const hourly: Array<{ hour: number; total: number }> = [];
  for (let h = 0; h < 24; h++) {
    hourly.push({ hour: h, total: hourlyByHour.get(h) ?? 0 });
  }
  const hourlyMax = Math.max(1, ...hourly.map((p) => p.total));

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
    opened_by_email: string;
  }>;
  const recent = recentR.rows as Array<{
    kind: "sale" | "refund";
    id: string;
    sale_number: string;
    total_amount: string;
    status: "completed" | "voided" | "refunded";
    happened_at: string;
    reason: string | null;
  }>;

  const today = new Date();
  const todayLabel = today.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <AdminShell email={cashier.email} active="dashboard" code={code}>
      <main className="p-6 lg:p-10">
        <div className="max-w-[1440px] mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-wrap justify-between items-end gap-3 mb-2">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-carbon-text">
                Daily Overview
              </h1>
              <p className="text-base text-carbon-text-muted mt-1">
                Today&apos;s performance metrics and recent activity.
              </p>
            </div>
            <div className="flex items-center gap-2 text-carbon-blue text-[11px] uppercase tracking-wider font-bold">
              <span className="material-symbols-outlined text-sm">calendar_today</span>
              <span>{todayLabel}</span>
            </div>
          </div>

          {/* KPI bento */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <KpiCard
              label="Net Sales"
              icon="payments"
              value={formatMoney(todayRev)}
              delta={pctDelta(todayRev, yestRev)}
              accentBar
            />
            <KpiCard
              label="Average Order Value"
              icon="shopping_bag"
              value={formatMoney(todayAov)}
              delta={pctDelta(todayAov, yestAov)}
            />
            <KpiCard
              label="Transactions"
              icon="receipt_long"
              value={String(todayTx)}
              delta={pctDelta(todayTx, yestTx)}
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
                    href={`/reports/${code}/sales-tax`}
                    className="text-[11px] uppercase tracking-wider font-bold text-carbon-blue border border-carbon-blue px-3 py-1 hover:bg-[var(--carbon-blue-soft)] transition-colors"
                  >
                    Export
                  </Link>
                </div>
                <HourlyChart points={hourly} max={hourlyMax} />
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
                      href={`/sales/${code}/register`}
                      className="text-[11px] uppercase tracking-wider font-bold text-carbon-blue hover:underline"
                    >
                      Manage →
                    </Link>
                  </div>
                  {openSessions.length === 0 ? (
                    <div className="text-sm text-carbon-text-muted">
                      <p>No registers are open right now.</p>
                      <Link
                        href={`/sales/${code}/register`}
                        className="carbon-btn-primary tap inline-flex items-center justify-center px-4 mt-3 text-sm"
                      >
                        Open a register
                      </Link>
                    </div>
                  ) : (
                    <ul className="divide-y divide-carbon-border-soft">
                      {openSessions.map((s) => (
                        <li key={s.id} className="py-3 flex justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">
                              {s.register_name}
                            </p>
                            <p className="text-xs text-carbon-text-muted truncate">
                              {s.opened_by_email} ·{" "}
                              {new Date(s.opened_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                          <p className="text-right font-mono tabular-nums shrink-0">
                            {formatMoney(s.opening_cash)}
                          </p>
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
  accentBar,
}: {
  label: string;
  icon: string;
  value: string;
  /** Signed pct vs previous period. null when no baseline (e.g. yesterday=0). */
  delta: number | null;
  accentBar?: boolean;
}) {
  const positive = (delta ?? 0) >= 0;
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
              {positive ? "arrow_upward" : "arrow_downward"}
            </span>
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : (
          <span className="font-mono text-sm text-carbon-text-muted">—</span>
        )}
      </div>
      <p className="text-xs text-carbon-text-muted mt-2">vs. previous day</p>
    </div>
  );
}

function HourlyChart({
  points,
  max,
}: {
  points: Array<{ hour: number; total: number }>;
  max: number;
}) {
  // Map each point to the SVG viewBox 0..100 in x and 0..100 in y (inverted).
  const pathParts = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = 100 - (p.total / max) * 90;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
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
          d={pathParts.join(" ")}
          fill="none"
          stroke="var(--carbon-blue)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
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
}: {
  row: {
    kind: "sale" | "refund";
    id: string;
    sale_number: string;
    total_amount: string;
    status: "completed" | "voided" | "refunded";
    happened_at: string;
  };
  code: string;
}) {
  const isRefund = row.kind === "refund";
  const isVoided = row.status === "voided";
  const icon = isRefund
    ? "assignment_return"
    : isVoided
      ? "cancel"
      : "check_circle";
  const iconClass = isRefund
    ? "text-carbon-text-muted"
    : isVoided
      ? "text-carbon-danger"
      : "text-carbon-blue";
  const amountClass = isRefund
    ? "text-carbon-danger"
    : isVoided
      ? "text-carbon-text-muted line-through"
      : "text-carbon-text";
  const verb = isRefund
    ? "Refund processed"
    : isVoided
      ? "Sale voided"
      : "Sale completed";

  return (
    <Link
      href={`/sales/${code}/${row.kind === "sale" ? row.id : ""}`}
      className="flex items-start gap-3 py-3 border-b border-carbon-border-soft last:border-0 hover:bg-carbon-bg transition-colors"
    >
      <div className="w-8 h-8 bg-[var(--carbon-surface-soft)] flex items-center justify-center flex-shrink-0">
        <span className={`material-symbols-outlined text-sm ${iconClass}`}>
          {icon}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-carbon-text truncate">
          {verb}{" "}
          <span className="font-mono text-carbon-blue">#{row.sale_number}</span>
        </p>
        <p className="text-[11px] text-carbon-text-muted uppercase tracking-wider font-bold">
          {timeAgo(row.happened_at)}
        </p>
      </div>
      <p
        className={`font-mono font-semibold tabular-nums shrink-0 ${amountClass}`}
      >
        {isRefund ? "−" : ""}
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
