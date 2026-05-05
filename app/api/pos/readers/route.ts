import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const assignSchema = z.object({
  register_id: z.number().int().positive(),
  reader_id: z.string().nullable(),
  reader_label: z.string().nullable().optional(),
});

/**
 * GET  /api/pos/readers   — list every Stripe Terminal reader on the account
 *                            and which register (if any) currently uses it.
 * POST /api/pos/readers   — assign a reader to a register (or pass reader_id
 *                            null to unassign).
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let stripeReaders: Array<{
    id: string;
    label: string;
    status: string | null;
    device_type: string | null;
    serial_number: string | null;
  }> = [];
  let stripeError: string | null = null;
  try {
    const list = await stripe().terminal.readers.list({ limit: 50 });
    stripeReaders = list.data.map((r) => ({
      id: r.id,
      label: r.label ?? r.id,
      status: r.status ?? null,
      device_type: r.device_type ?? null,
      serial_number: r.serial_number ?? null,
    }));
  } catch (err) {
    console.error("[readers/list]", err);
    stripeError = "Stripe is not configured. Set STRIPE_SECRET_KEY first.";
  }
  const pool = getPool();
  const reg = await pool.query(
    `SELECT r.id, r.name, r.stripe_reader_id, r.stripe_reader_label,
            l.name AS location_name
       FROM pos_registers r
       JOIN pos_locations pl ON pl.id = r.pos_location_id
       JOIN locations l      ON l.id = pl.wms_location_id
      ORDER BY l.name, r.name`,
  );
  return NextResponse.json({
    stripe_readers: stripeReaders,
    stripe_error: stripeError,
    registers: reg.rows,
  });
}

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { register_id, reader_id, reader_label } = parsed.data;
  const pool = getPool();
  const r = await pool.query(
    `UPDATE pos_registers
        SET stripe_reader_id = $1,
            stripe_reader_label = $2
      WHERE id = $3
      RETURNING *`,
    [reader_id, reader_label ?? null, register_id],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ register: r.rows[0] });
}
