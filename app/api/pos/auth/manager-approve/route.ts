import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { signApproval } from "@/lib/approval-token";

const schema = z.object({ pin: z.string().regex(/^\d{4}$/).optional() });

/**
 * POST /api/pos/auth/manager-approve  { pin? }
 * Approves a large discount. A manager/admin ringing the sale is approved
 * without a PIN; otherwise the PIN must belong to an active manager/admin
 * at this store. Returns a signed approval token the cart carries to
 * checkout (verified by /api/pos/payment/capture).
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const pool = getPool();
  const nameOf = (r: { first_name?: string | null; last_name?: string | null; email: string }) =>
    [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email;

  if (cashier.role === "manager" || cashier.role === "admin") {
    const me = await pool.query(
      `SELECT u.first_name, u.last_name, u.email FROM users u WHERE u.id = $1::uuid`,
      [cashier.user_id],
    );
    const name = me.rows[0] ? nameOf(me.rows[0]) : (cashier.email ?? "Manager");
    return NextResponse.json({
      token: signApproval({ eid: cashier.employee_id, name, lid: cashier.lid }),
      approver: name,
    });
  }

  if (!parsed.data.pin) {
    return NextResponse.json({ error: "pin_required" }, { status: 401 });
  }
  const r = await pool.query(
    `SELECT pe.id, pe.pin_hash, u.first_name, u.last_name, u.email
       FROM pos_employees pe
       JOIN users u ON u.id = pe.user_id
      WHERE pe.is_active AND pe.role IN ('manager','admin')
        AND (EXISTS (SELECT 1 FROM user_locations ul
                      WHERE ul.user_id = pe.user_id AND ul.location_id = $1::uuid)
             OR NOT EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = pe.user_id))
      ORDER BY pe.id`,
    [cashier.lid],
  );
  for (const row of r.rows) {
    if (await bcrypt.compare(parsed.data.pin, row.pin_hash)) {
      const name = nameOf(row);
      return NextResponse.json({
        token: signApproval({ eid: row.id, name, lid: cashier.lid }),
        approver: name,
      });
    }
  }
  return NextResponse.json(
    { error: "bad_pin", message: "That PIN isn't a manager's PIN at this store." },
    { status: 401 },
  );
}
