import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({ customer_id: z.number().int().positive().nullable() });

/**
 * PATCH /api/pos/sales/:id/customer — attach, change or remove the
 * customer on a finished sale (manager/admin). Locked once store credit
 * is involved (paid with it, or refunded to it): that money already
 * belongs to a specific customer's balance.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (cashier.role !== "manager" && cashier.role !== "admin") {
    return NextResponse.json({ error: "forbidden", message: "Only managers can change the customer on a sale." }, { status: 403 });
  }
  const { id } = await ctx.params;
  const saleId = Number(id);
  if (!Number.isFinite(saleId)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const customerId = parsed.data.customer_id;

  const pool = getPool();
  const credit = await pool.query<{ n: string }>(
    `SELECT (
       (SELECT count(*) FROM pos_payments WHERE sale_id = $1 AND method = 'store_credit') +
       (SELECT count(*) FROM pos_refunds  WHERE original_sale_id = $1 AND method = 'store_credit')
     )::text AS n`,
    [saleId],
  );
  if (Number(credit.rows[0]?.n ?? 0) > 0) {
    return NextResponse.json(
      {
        error: "locked",
        message: "This sale used store credit, so its customer can't be changed.",
      },
      { status: 409 },
    );
  }
  if (customerId != null) {
    const c = await pool.query(`SELECT 1 FROM pos_customers WHERE id = $1`, [customerId]);
    if (c.rows.length === 0) return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }
  const r = await pool.query(
    `UPDATE pos_sales SET customer_id = $2 WHERE id = $1 RETURNING id`,
    [saleId, customerId],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
