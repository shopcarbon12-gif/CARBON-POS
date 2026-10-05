import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const schema = z.object({
  /** Store-local "YYYY-MM-DDTHH:MM" (datetime-local input value). */
  clock_in: z.string().regex(LOCAL).optional(),
  /** Store-local time, "now" to clock out at the current time, or null to reopen. */
  clock_out: z.union([z.string().regex(LOCAL), z.literal("now"), z.null()]).optional(),
});

/**
 * PATCH /api/pos/clock/:id — manager correction of a shift (forgotten
 * clock-out, wrong times). Times are entered in the store's time zone.
 * DELETE — remove a mistaken shift.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number((await ctx.params).id);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!Number.isFinite(id) || !parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { clock_in, clock_out } = parsed.data;
  try {
    const row = await withTransaction(async (client) => {
      const r = await client.query(
        `WITH tz AS (
           SELECT COALESCE((SELECT timezone FROM pos_locations WHERE wms_location_id = $4::uuid LIMIT 1),
                           'America/New_York') AS tz
         )
         UPDATE pos_employee_clock c
            SET clock_in  = COALESCE($2::timestamp AT TIME ZONE tz.tz, c.clock_in),
                clock_out = CASE WHEN $5::boolean THEN
                              CASE WHEN $3::text = 'now' THEN now()
                                   WHEN $3::text IS NULL THEN NULL
                                   ELSE $3::timestamp AT TIME ZONE tz.tz END
                            ELSE c.clock_out END
           FROM tz
          WHERE c.id = $1
          RETURNING c.id, c.clock_in, c.clock_out`,
        [id, clock_in ?? null, clock_out ?? null, cashier.lid, clock_out !== undefined],
      );
      const updated = r.rows[0];
      if (updated?.clock_out && new Date(updated.clock_out) < new Date(updated.clock_in)) {
        throw new Error("bad_times"); // rolls the change back
      }
      return updated;
    });
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ shift: row });
  } catch (err) {
    if ((err as Error).message === "bad_times") {
      return NextResponse.json(
        { error: "bad_times", message: "Clock-out is before clock-in." },
        { status: 400 },
      );
    }
    throw err;
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number((await ctx.params).id);
  await getPool().query(`DELETE FROM pos_employee_clock WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
