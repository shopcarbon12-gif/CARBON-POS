import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const createSchema = z.object({
  pos_location_id: z.number().int().positive(),
  name: z.string().min(1).max(120),
});

/**
 * POST /api/pos/registers/manage — create a new register.
 *
 * The bare GET on /api/pos/registers stays focused on the picker view (only
 * active rows + open_session). Putting the create here keeps that endpoint
 * unchanged and avoids confusion with the cashier-facing list.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO pos_registers (pos_location_id, name, is_active)
     VALUES ($1, $2, TRUE)
     RETURNING *`,
    [parsed.data.pos_location_id, parsed.data.name],
  );
  return NextResponse.json({ register: r.rows[0] });
}
