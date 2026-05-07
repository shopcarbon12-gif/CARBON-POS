import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { DateRangeReport } from "@/components/admin/DateRangeReport";

export default async function DiscountsReport({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { code } = await params;
  await pageGuard(code, {
    tab: "reports",
    from: `/reports/${code}/discounts`,
  }, { requireRole: ["manager", "admin"] });
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from || firstDayOfMonth();
  const to = sp.to || today;
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.completed_at,
            s.sale_number,
            u.email AS cashier_email,
            sl.description,
            sl.unit_price,
            sl.quantity,
            sl.discount_amount,
            sl.line_total
       FROM pos_sale_lines sl
       JOIN pos_sales s      ON s.id = sl.sale_id
       JOIN pos_employees pe ON pe.id = s.cashier_id
       JOIN users u          ON u.id = pe.user_id
      WHERE s.status = 'completed'
        AND s.completed_at::date BETWEEN $1 AND $2
        AND sl.discount_amount > 0
      ORDER BY s.completed_at DESC
      LIMIT 1000`,
    [from, to],
  );
  const rows = r.rows.map((row) => ({
    when: new Date(row.completed_at).toLocaleString(),
    sale: row.sale_number,
    cashier: row.cashier_email,
    item: row.description,
    qty: row.quantity,
    unit: formatMoney(row.unit_price),
    discount: formatMoney(row.discount_amount),
    line: formatMoney(row.line_total),
  }));
  return (
    <DateRangeReport
      code={code}
      title="Discounts Applied"
      description="Every line where a discount was applied. Capped at 1000 rows."
      endpoint="discounts"
      from={from}
      to={to}
      rows={rows}
      columns={[
        { header: "When", key: "when" },
        { header: "Sale", key: "sale" },
        { header: "Cashier", key: "cashier" },
        { header: "Item", key: "item" },
        { header: "Qty", key: "qty", align: "right" },
        { header: "Unit", key: "unit", align: "right" },
        { header: "Discount", key: "discount", align: "right" },
        { header: "Line total", key: "line", align: "right" },
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
