import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  epc: z.string().min(8).max(64),
  status: z.enum(["damaged", "in-stock"]),
  reason: z.string().max(300).optional(),
});

/**
 * POST /api/pos/items/tag-status — manager/admin marks one tag at this
 * store damaged, or puts a damaged tag back in stock (e.g. a returned
 * piece that turned out to be faulty). Only those two moves are allowed,
 * so sold / in-transit tags can't be touched from the POS. Logged to
 * inventory_audit_logs like every other WMS status change.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (cashier.role !== "manager" && cashier.role !== "admin") {
    return NextResponse.json({ error: "forbidden", message: "Only managers can change stock status." }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { status, reason } = parsed.data;
  const epc = parsed.data.epc.toUpperCase();
  const from = status === "damaged" ? "in-stock" : "damaged";

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query<{ epc: string }>(
      `UPDATE items SET status = $3
        WHERE upper(epc) = $1 AND location_id = $2::uuid AND status = $4
       RETURNING epc`,
      [epc, cashier.lid, status, from],
    );
    if (r.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "not_allowed",
          message: `This tag isn't ${from === "in-stock" ? "in stock" : "marked damaged"} at this store, so it can't be changed here.`,
        },
        { status: 409 },
      );
    }
    await client.query(
      `INSERT INTO inventory_audit_logs
         (tenant_id, log_type, entity_type, entity_reference,
          old_value, new_value, reason, user_id, user_uuid)
       VALUES ($1::uuid, 'STATUS_CHANGE', 'EPC', $2, $3, $4, $5, NULL, $6::uuid)`,
      [cashier.tid, r.rows[0].epc, from, status, `POS: ${reason?.trim() || (status === "damaged" ? "marked damaged" : "back in stock")}`, cashier.user_id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
