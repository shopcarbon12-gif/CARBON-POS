import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const customerInput = z.object({
  first_name: z.string().min(1).max(120),
  last_name: z.string().max(120).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  customer_type: z
    .enum(["regular", "vip", "staff", "wholesale"])
    .optional(),
  pos_location_id: z.number().int().positive().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * GET  /api/pos/customers?q=…    — search/list (top 50)
 * POST /api/pos/customers        — create
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const pool = getPool();
  const args: unknown[] = [];
  let where = "";
  if (q.length > 0) {
    args.push(`%${q}%`);
    where = `WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1`;
  }
  const r = await pool.query(
    `SELECT id, first_name, last_name, email, phone, customer_type,
            store_credit_balance, created_at
       FROM pos_customers
       ${where}
      ORDER BY last_name NULLS LAST, first_name
      LIMIT 50`,
    args,
  );
  return NextResponse.json({ customers: r.rows });
}

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = customerInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO pos_customers
       (first_name, last_name, email, phone, birthday,
        customer_type, pos_location_id, notes)
     VALUES ($1,$2,$3,$4,$5, $6, $7, $8)
     RETURNING *`,
    [
      d.first_name,
      d.last_name ?? null,
      d.email ?? null,
      d.phone ?? null,
      d.birthday ?? null,
      d.customer_type ?? "regular",
      d.pos_location_id ?? null,
      d.notes ?? null,
    ],
  );
  return NextResponse.json({ customer: r.rows[0] });
}
