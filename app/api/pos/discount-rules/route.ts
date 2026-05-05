import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["percent", "fixed"]),
  value: z.number().nonnegative(),
  applies_to: z.enum(["all", "customer_type", "sku_id"]),
  applies_to_value: z.string().nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  requires_manager_pin: z.boolean().optional(),
  pos_location_id: z.number().int().positive().nullable().optional(),
});

export async function GET() {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM pos_discount_rules ORDER BY is_active DESC, name`,
  );
  return NextResponse.json({ rules: r.rows });
}

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO pos_discount_rules
       (pos_location_id, name, type, value, applies_to, applies_to_value,
        start_date, end_date, requires_manager_pin, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, TRUE)
     RETURNING *`,
    [
      d.pos_location_id ?? null,
      d.name,
      d.type,
      d.value,
      d.applies_to,
      d.applies_to_value ?? null,
      d.start_date ?? null,
      d.end_date ?? null,
      d.requires_manager_pin ?? false,
    ],
  );
  return NextResponse.json({ rule: r.rows[0] });
}
