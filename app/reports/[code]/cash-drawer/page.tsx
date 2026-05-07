import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { DateRangeReport } from "@/components/admin/DateRangeReport";

export default async function CashDrawerReport({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { code } = await params;
  await pageGuard(code, {
    tab: "reports",
    from: `/reports/${code}/cash-drawer`,
  }, { requireRole: ["manager", "admin"] });
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from || firstDayOfMonth();
  const to = sp.to || today;
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.id,
            r.name                                      AS register_name,
            uo.email                                    AS opened_by,
            uc.email                                    AS closed_by,
            s.opened_at,
            s.closed_at,
            s.opening_cash,
            s.expected_cash,
            s.closing_cash_counted,
            s.cash_over_short,
            COALESCE((SELECT SUM(amount) FROM pos_cash_movements
                       WHERE register_session_id = s.id AND type = 'drop'), 0)   AS drops,
            COALESCE((SELECT SUM(amount) FROM pos_cash_movements
                       WHERE register_session_id = s.id AND type = 'payout'), 0) AS payouts
       FROM pos_register_sessions s
       JOIN pos_registers r ON r.id = s.register_id
       JOIN users uo        ON uo.id = s.opened_by
       LEFT JOIN users uc   ON uc.id = s.closed_by
      WHERE s.status = 'closed'
        AND s.closed_at::date BETWEEN $1 AND $2
      ORDER BY s.closed_at DESC`,
    [from, to],
  );
  const rows = r.rows.map((row) => ({
    register: row.register_name,
    opened_by: row.opened_by,
    closed_by: row.closed_by ?? "",
    opened_at: new Date(row.opened_at).toLocaleString(),
    closed_at: row.closed_at ? new Date(row.closed_at).toLocaleString() : "",
    opening: formatMoney(row.opening_cash),
    expected:
      row.expected_cash !== null ? formatMoney(row.expected_cash) : "—",
    counted:
      row.closing_cash_counted !== null
        ? formatMoney(row.closing_cash_counted)
        : "—",
    over_short:
      row.cash_over_short !== null ? formatMoney(row.cash_over_short) : "—",
    drops: formatMoney(row.drops),
    payouts: formatMoney(row.payouts),
  }));
  return (
    <DateRangeReport
      code={code}
      title="Cash Drawer Log"
      description="Every closed register session in the window."
      endpoint="cash-drawer"
      from={from}
      to={to}
      rows={rows}
      columns={[
        { header: "Register", key: "register" },
        { header: "Opened by", key: "opened_by" },
        { header: "Opened", key: "opened_at" },
        { header: "Closed", key: "closed_at" },
        { header: "Opening", key: "opening", align: "right" },
        { header: "Expected", key: "expected", align: "right" },
        { header: "Counted", key: "counted", align: "right" },
        { header: "Over/Short", key: "over_short", align: "right" },
        { header: "Drops", key: "drops", align: "right" },
        { header: "Payouts", key: "payouts", align: "right" },
      ]}
    />
  );
}

function firstDayOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}
