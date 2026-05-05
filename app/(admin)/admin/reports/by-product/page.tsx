import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { DateRangeReport } from "@/components/admin/DateRangeReport";

export default async function ByProductReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/reports/by-product");
  }
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from || firstDayOfMonth();
  const to = sp.to || today;
  const pool = getPool();
  const r = await pool.query(
    `SELECT sl.sku_id,
            COALESCE(cs.item_name, sl.description) AS item_name,
            cs.color, cs.size, cs.sku,
            SUM(sl.quantity)::int                  AS qty,
            COALESCE(SUM(sl.line_total), 0)        AS revenue
       FROM pos_sale_lines sl
       JOIN pos_sales s   ON s.id = sl.sale_id
       LEFT JOIN custom_skus cs ON cs.id = sl.sku_id
      WHERE s.status = 'completed'
        AND s.completed_at::date BETWEEN $1 AND $2
      GROUP BY sl.sku_id, item_name, cs.color, cs.size, cs.sku
      ORDER BY revenue DESC
      LIMIT 500`,
    [from, to],
  );
  const rows = r.rows.map((row) => ({
    sku: row.sku ?? "—",
    item: row.item_name,
    color: row.color ?? "",
    size: row.size ?? "",
    qty: row.qty,
    revenue: formatMoney(row.revenue),
  }));
  return (
    <DateRangeReport
      title="Sales by Product"
      description="Top SKUs by revenue. Capped at 500 rows."
      endpoint="by-product"
      from={from}
      to={to}
      rows={rows}
      columns={[
        { header: "SKU", key: "sku" },
        { header: "Item", key: "item" },
        { header: "Color", key: "color" },
        { header: "Size", key: "size" },
        { header: "Qty", key: "qty", align: "right" },
        { header: "Revenue", key: "revenue", align: "right" },
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
