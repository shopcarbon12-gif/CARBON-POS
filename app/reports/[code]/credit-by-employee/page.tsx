import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { DateRangeReport } from "@/components/admin/DateRangeReport";

/**
 * Sales Credit by Employee — line-level attribution view. Uses
 * pos_sale_lines.attributed_employee_id so commission credit lands on
 * whichever sales associate the cashier assigned, even when the cashier
 * ringing the sale is someone else.
 *
 * Sibling to /reports/[code]/by-employee, which keys off
 * pos_sales.cashier_id (register productivity, not credit).
 */
export default async function CreditByEmployeeReport({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { code } = await params;
  await pageGuard(code, {
    tab: "reports",
    from: `/reports/${code}/credit-by-employee`,
  }, { requireRole: ["manager", "admin"] });
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from || firstDayOfMonth();
  const to = sp.to || today;
  const pool = getPool();
  const r = await pool.query(
    `SELECT u.email                              AS employee,
            COUNT(DISTINCT s.id)                  AS sale_count,
            COUNT(*)                              AS line_count,
            COALESCE(SUM(sl.quantity), 0)         AS units_sold,
            COALESCE(SUM(sl.line_total), 0)       AS revenue,
            COALESCE(SUM(sl.discount_amount), 0)  AS discount,
            COALESCE(SUM(sl.tax_amount), 0)       AS tax
       FROM pos_sale_lines sl
       JOIN pos_sales s      ON s.id = sl.sale_id
       JOIN pos_employees pe ON pe.id = sl.attributed_employee_id
       JOIN users u          ON u.id = pe.user_id
      WHERE s.status = 'completed'
        AND s.completed_at::date BETWEEN $1 AND $2
      GROUP BY u.email
      ORDER BY revenue DESC`,
    [from, to],
  );
  const rows = r.rows.map((row) => ({
    employee: row.employee,
    sale_count: row.sale_count,
    line_count: row.line_count,
    units_sold: row.units_sold,
    revenue: formatMoney(row.revenue),
    discount: formatMoney(row.discount),
    tax: formatMoney(row.tax),
  }));
  return (
    <DateRangeReport
      code={code}
      title="Sales Credit by Employee"
      description="Per-line attribution — who actually earned credit for each item. Use this for commissions."
      endpoint="credit-by-employee"
      from={from}
      to={to}
      rows={rows}
      columns={[
        { header: "Employee", key: "employee" },
        { header: "Sales", key: "sale_count", align: "right" },
        { header: "Lines", key: "line_count", align: "right" },
        { header: "Units", key: "units_sold", align: "right" },
        { header: "Revenue", key: "revenue", align: "right" },
        { header: "Discounts", key: "discount", align: "right" },
        { header: "Tax", key: "tax", align: "right" },
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
