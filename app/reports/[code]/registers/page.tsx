import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { storeToday } from "@/lib/reports";
import { ReportShell } from "@/components/admin/ReportShell";

/**
 * Register Reports — every register open / close at this store. Each
 * session links to its saved Open report and End of Day report (view +
 * reprint).
 */
export default async function RegisterReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "reports",
    from: `/reports/${code}/registers`,
  }, { requireRole: ["manager", "admin"] });
  const sp = await searchParams;
  const pool = getPool();
  const tzR = await pool.query(
    `SELECT COALESCE(timezone, 'America/New_York') AS tz
       FROM pos_locations WHERE wms_location_id = $1::uuid LIMIT 1`,
    [cashier.lid],
  );
  const today = storeToday(tzR.rows[0]?.tz ?? "America/New_York");
  const from = sp.from || daysAgo(today, 30);
  const to = sp.to || today;

  const r = await pool.query(
    `SELECT s.id, s.status, s.opened_at, s.closed_at,
            s.opening_cash, s.expected_cash, s.closing_cash_counted,
            s.cash_over_short,
            r.name AS register_name,
            pl.timezone,
            COALESCE(NULLIF(TRIM(COALESCE(uo.first_name,'') || ' ' || COALESCE(uo.last_name,'')), ''), uo.email) AS opened_by,
            COALESCE(NULLIF(TRIM(COALESCE(uc.first_name,'') || ' ' || COALESCE(uc.last_name,'')), ''), uc.email) AS closed_by
       FROM pos_register_sessions s
       JOIN pos_registers r  ON r.id = s.register_id
       JOIN pos_locations pl ON pl.id = r.pos_location_id
       JOIN users uo         ON uo.id = s.opened_by
       LEFT JOIN users uc    ON uc.id = s.closed_by
      WHERE pl.wms_location_id = $1::uuid
        AND (s.opened_at AT TIME ZONE COALESCE(pl.timezone, 'America/New_York'))::date
            BETWEEN $2::date AND $3::date
      ORDER BY s.opened_at DESC`,
    [cashier.lid, from, to],
  );

  return (
    <ReportShell
      code={code}
      title="Register Reports"
      description="Every register open and close at this store. Click a report to view or reprint it."
      filters={
        <form className="flex gap-3 items-end flex-wrap">
          <label className="text-xs font-medium">
            <span className="block mb-1">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
            />
          </label>
          <label className="text-xs font-medium">
            <span className="block mb-1">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
            />
          </label>
          <button
            type="submit"
            className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-4"
          >
            Run report
          </button>
        </form>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
          <thead className="bg-[var(--color-pos-bg)]">
            <tr className="text-left">
              <th className="px-3 py-2">Register</th>
              <th className="px-3 py-2">Opened</th>
              <th className="px-3 py-2">Closed</th>
              <th className="px-3 py-2 text-right">Opening</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">Counted</th>
              <th className="px-3 py-2 text-right">Over/Short</th>
              <th className="px-3 py-2">Reports</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
                >
                  No register sessions in this range.
                </td>
              </tr>
            ) : (
              r.rows.map((row) => {
                const tz = row.timezone || "America/New_York";
                const os = row.cash_over_short != null ? Number(row.cash_over_short) : null;
                return (
                  <tr key={row.id} className="border-t border-[var(--color-pos-border)] align-top">
                    <td className="px-3 py-2 font-semibold">{row.register_name}</td>
                    <td className="px-3 py-2">
                      {fmt(row.opened_at, tz)}
                      <div className="text-xs text-carbon-text-muted">{row.opened_by}</div>
                    </td>
                    <td className="px-3 py-2">
                      {row.status === "open" ? (
                        <span className="font-semibold text-emerald-700">Still open</span>
                      ) : (
                        <>
                          {row.closed_at ? fmt(row.closed_at, tz) : "—"}
                          <div className="text-xs text-carbon-text-muted">{row.closed_by ?? ""}</div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.opening_cash)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.expected_cash != null ? formatMoney(row.expected_cash) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.closing_cash_counted != null ? formatMoney(row.closing_cash_counted) : "—"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        os == null || Math.abs(os) < 0.005
                          ? ""
                          : os > 0
                            ? "text-emerald-700"
                            : "text-carbon-danger"
                      }`}
                    >
                      {os != null ? formatMoney(os) : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/reports/${code}/registers/${row.id}?type=open`}
                        className="text-carbon-blue font-semibold hover:underline"
                      >
                        Open report
                      </Link>
                      {row.status === "closed" && (
                        <>
                          <span className="text-carbon-text-muted"> · </span>
                          <Link
                            href={`/reports/${code}/registers/${row.id}?type=eod`}
                            className="text-carbon-blue font-semibold hover:underline"
                          >
                            End of Day
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}

function fmt(v: string | Date, tz: string): string {
  return new Date(v).toLocaleString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function daysAgo(from: string, n: number): string {
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
