import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { DateRangeReport } from "@/components/admin/DateRangeReport";

export default async function ByEmployeeReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/reports/by-employee");
  }
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from || firstDayOfMonth();
  const to = sp.to || today;
  const pool = getPool();
  const r = await pool.query(
    `SELECT u.email                              AS cashier,
            COUNT(*)                              AS tx_count,
            COALESCE(SUM(s.total_amount), 0)     AS revenue,
            COALESCE(SUM(s.tax_amount), 0)       AS tax,
            COALESCE(SUM(s.discount_amount), 0)  AS discount
       FROM pos_sales s
       JOIN pos_employees pe ON pe.id = s.cashier_id
       JOIN users u          ON u.id = pe.user_id
      WHERE s.status = 'completed'
        AND s.completed_at::date BETWEEN $1 AND $2
      GROUP BY u.email
      ORDER BY revenue DESC`,
    [from, to],
  );
  const rows = r.rows.map((row) => ({
    cashier: row.cashier,
    tx_count: row.tx_count,
    revenue: formatMoney(row.revenue),
    tax: formatMoney(row.tax),
    discount: formatMoney(row.discount),
  }));
  return (
    <DateRangeReport
      title="Sales by Employee"
      description="Cashier totals for the date range."
      endpoint="by-employee"
      from={from}
      to={to}
      rows={rows}
      columns={[
        { header: "Cashier", key: "cashier" },
        { header: "Transactions", key: "tx_count", align: "right" },
        { header: "Revenue", key: "revenue", align: "right" },
        { header: "Tax", key: "tax", align: "right" },
        { header: "Discounts", key: "discount", align: "right" },
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
