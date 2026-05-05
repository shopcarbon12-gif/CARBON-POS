import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const createSchema = z.object({
  wms_location_id: z.string().uuid(),
  tax_rate: z.number().min(0).max(0.5).optional(),
  receipt_header: z.string().nullable().optional(),
  receipt_footer: z.string().nullable().optional(),
  return_policy: z.string().nullable().optional(),
  address_line1: z.string().nullable().optional(),
  address_line2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  timezone: z.string().optional(),
});

/**
 * GET  /api/pos/locations  — list pos_locations + their wms name + register count
 * POST /api/pos/locations  — link a new WMS location into POS
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT pl.*, l.name AS wms_name,
            (SELECT COUNT(*) FROM pos_registers r WHERE r.pos_location_id = pl.id) AS register_count
       FROM pos_locations pl
       JOIN locations l ON l.id = pl.wms_location_id
      ORDER BY l.name`,
  );
  // Also return WMS locations not yet linked, so the UI can offer them.
  const w = await pool.query(
    `SELECT l.id, l.name
       FROM locations l
      WHERE NOT EXISTS (SELECT 1 FROM pos_locations pl WHERE pl.wms_location_id = l.id)
      ORDER BY l.name`,
  );
  return NextResponse.json({
    locations: r.rows,
    available_wms_locations: w.rows,
  });
}

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
  const d = parsed.data;
  const pool = getPool();
  try {
    const r = await pool.query(
      `INSERT INTO pos_locations
         (wms_location_id, tax_rate, receipt_header, receipt_footer,
          return_policy, address_line1, address_line2, city, state, zip,
          phone, timezone, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
       RETURNING *`,
      [
        d.wms_location_id,
        d.tax_rate ?? 0.07,
        d.receipt_header ?? null,
        d.receipt_footer ?? null,
        d.return_policy ?? null,
        d.address_line1 ?? null,
        d.address_line2 ?? null,
        d.city ?? null,
        d.state ?? null,
        d.zip ?? null,
        d.phone ?? null,
        d.timezone ?? "America/New_York",
      ],
    );
    return NextResponse.json({ location: r.rows[0] });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        {
          error: "duplicate",
          message: "This WMS location is already linked to a POS location.",
        },
        { status: 409 },
      );
    }
    console.error("[locations/create]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
