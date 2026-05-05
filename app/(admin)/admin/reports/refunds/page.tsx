import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { DateRangeReport } from "@/components/admin/DateRangeReport";

export default async function RefundsReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/reports/refunds");
  }
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from || firstDayOfMonth();
  const to = sp.to || today;
  const pool = getPool();
  const refunds = await pool.query(
    `SELECT r.created_at,
            s.sale_number,
            r.amount,
            r.method,
            r.reason,
            uo.email AS by_email
       FROM pos_refunds r
       JOIN pos_sales s      ON s.id = r.original_sale_id
       JOIN pos_employees pe ON pe.id = r.refunded_by
       JOIN users uo         ON uo.id = pe.user_id
      WHERE r.created_at::date BETWEEN $1 AND $2
      ORDER BY r.created_at DESC`,
    [from, to],
  );
  const voids = await pool.query(
    `SELECT s.voided_at  AS created_at,
            s.sale_number,
            s.total_amount AS amount,
            'void'        AS method,
            s.void_reason AS reason,
            u.email       AS by_email
       FROM pos_sales s
       LEFT JOIN pos_employees pe ON pe.id = s.voided_by
       LEFT JOIN users u          ON u.id = pe.user_id
      WHERE s.status = 'voided'
        AND s.voided_at::date BETWEEN $1 AND $2
      ORDER BY s.voided_at DESC`,
    [from, to],
  );
  const all = [...refunds.rows, ...voids.rows].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const rows = all.map((row) => ({
    when: new Date(row.created_at).toLocaleString(),
    sale: row.sale_number,
    amount: formatMoney(row.amount),
    method: row.method,
    reason: row.reason ?? "",
    by: row.by_email ?? "",
  }));
  return (
    <DateRangeReport
      title="Refunds & Voids"
      description="Combined view of refunded sales and voided sales."
      endpoint="refunds"
      from={from}
      to={to}
      rows={rows}
      columns={[
        { header: "When", key: "when" },
        { header: "Sale", key: "sale" },
        { header: "Method", key: "method" },
        { header: "Reason", key: "reason" },
        { header: "By", key: "by" },
        { header: "Amount", key: "amount", align: "right" },
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
