import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { toCsv } from "@/lib/csv";

const schema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(["json", "csv"]).optional(),
});

/**
 * GET /api/pos/reports/credit-by-employee?from&to&format
 *
 * Aggregates line-level attribution (pos_sale_lines.attributed_employee_id)
 * so a manager can see who actually earned credit for each line — even when
 * the cashier on duty rang on behalf of a different sales associate. This
 * is the source of truth for commission reporting.
 *
 * Contrast with /api/pos/reports/by-employee which groups by the ringing
 * cashier (pos_sales.cashier_id); that report stays for register-productivity
 * use cases.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { from, to, format } = parsed.data;
  const pool = getPool();
  // line_total already includes the line's discount + tax (see capture/route.ts),
  // so SUM(line_total) is the actual dollars credited to the employee.
  const r = await pool.query(
    `SELECT sl.attributed_employee_id,
            u.email                              AS employee_email,
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
      GROUP BY sl.attributed_employee_id, u.email
      ORDER BY revenue DESC`,
    [from, to],
  );
  if (format === "csv") {
    const csv = toCsv([
      [
        "employee",
        "sale_count",
        "line_count",
        "units_sold",
        "revenue",
        "discount",
        "tax",
      ],
      ...r.rows.map((row) => [
        row.employee_email,
        row.sale_count,
        row.line_count,
        row.units_sold,
        Number(row.revenue).toFixed(2),
        Number(row.discount).toFixed(2),
        Number(row.tax).toFixed(2),
      ]),
    ]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="credit-by-employee-${from}-to-${to}.csv"`,
      },
    });
  }
  return NextResponse.json({ rows: r.rows });
}
