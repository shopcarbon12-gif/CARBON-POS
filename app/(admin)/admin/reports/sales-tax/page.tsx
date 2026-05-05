import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { DateRangeReport } from "@/components/admin/DateRangeReport";

export default async function SalesTaxReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/reports/sales-tax");
  }
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from || firstDayOfMonth();
  const to = sp.to || today;
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.completed_at::date AS day,
            COUNT(*)                            AS tx_count,
            COALESCE(SUM(s.subtotal),0)         AS subtotal,
            COALESCE(SUM(s.discount_amount),0)  AS discount,
            COALESCE(SUM(s.tax_amount),0)       AS tax,
            COALESCE(SUM(s.total_amount),0)     AS total
       FROM pos_sales s
      WHERE s.status = 'completed'
        AND s.completed_at::date BETWEEN $1 AND $2
      GROUP BY day
      ORDER BY day`,
    [from, to],
  );
  const rows = r.rows.map((row) => ({
    day: new Date(row.day).toISOString().slice(0, 10),
    tx_count: row.tx_count,
    subtotal: formatMoney(row.subtotal),
    discount: formatMoney(row.discount),
    tax: formatMoney(row.tax),
    total: formatMoney(row.total),
  }));
  const totals = r.rows.reduce(
    (acc, row) => {
      acc.tx_count += Number(row.tx_count);
      acc.subtotal += Number(row.subtotal);
      acc.discount += Number(row.discount);
      acc.tax += Number(row.tax);
      acc.total += Number(row.total);
      return acc;
    },
    { tx_count: 0, subtotal: 0, discount: 0, tax: 0, total: 0 },
  );
  rows.push({
    day: "Total",
    tx_count: totals.tx_count,
    subtotal: formatMoney(totals.subtotal),
    discount: formatMoney(totals.discount),
    tax: formatMoney(totals.tax),
    total: formatMoney(totals.total),
  });
  return (
    <DateRangeReport
      title="Sales Tax"
      description="Daily totals + tax collected for your accountant."
      endpoint="sales-tax"
      from={from}
      to={to}
      rows={rows}
      columns={[
        { header: "Day", key: "day" },
        { header: "Transactions", key: "tx_count", align: "right" },
        { header: "Subtotal", key: "subtotal", align: "right" },
        { header: "Discount", key: "discount", align: "right" },
        { header: "Tax", key: "tax", align: "right" },
        { header: "Total", key: "total", align: "right" },
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
