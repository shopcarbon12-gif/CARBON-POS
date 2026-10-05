import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET  /api/pos/held-sales — parked carts at this store, newest first.
 * POST /api/pos/held-sales — park the current cart.
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await getPool().query(
    `SELECT h.id, h.label, h.customer_name, h.item_count, h.total, h.created_at,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS held_by
       FROM pos_held_sales h
       JOIN pos_locations pl ON pl.id = h.pos_location_id
       LEFT JOIN pos_employees pe ON pe.id = h.held_by
       LEFT JOIN users u          ON u.id = pe.user_id
      WHERE pl.wms_location_id = $1::uuid
      ORDER BY h.created_at DESC
      LIMIT 50`,
    [cashier.lid],
  );
  return NextResponse.json({ held: r.rows });
}

const schema = z.object({
  label: z.string().max(120).nullable().optional(),
  customer: z
    .object({ id: z.number().int().positive(), name: z.string().nullable().optional() })
    .passthrough()
    .nullable()
    .optional(),
  lines: z.array(z.record(z.string(), z.unknown())).min(1).max(300),
  total: z.number(),
});

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { label, customer, lines, total } = parsed.data;
  const itemCount = lines.reduce(
    (s, l) => s + (l.line_type === "loyalty_redemption" ? 0 : Number(l.quantity ?? 0)),
    0,
  );
  const r = await getPool().query(
    `INSERT INTO pos_held_sales
       (pos_location_id, held_by, customer_id, customer_name, label, cart, item_count, total)
     SELECT pl.id, $2, $3, $4, $5, $6::jsonb, $7, $8
       FROM pos_locations pl WHERE pl.wms_location_id = $1::uuid
     RETURNING id`,
    [
      cashier.lid,
      cashier.employee_id,
      customer?.id ?? null,
      customer?.name ?? null,
      label?.trim() || null,
      JSON.stringify({ lines, customer: customer ?? null }),
      itemCount,
      Math.round(total * 100) / 100,
    ],
  );
  if (!r.rows[0]) return NextResponse.json({ error: "no_location" }, { status: 404 });
  return NextResponse.json({ id: r.rows[0].id });
}
