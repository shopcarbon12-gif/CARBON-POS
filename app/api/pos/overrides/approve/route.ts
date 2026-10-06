import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { hashOverrideCode, OVERRIDE_KINDS, signOverride } from "@/lib/override";

const schema = z.object({
  kind: z.enum(OVERRIDE_KINDS),
  ref: z.string().min(1).max(100),
  /** Admin PIN typed on the register… */
  pin: z.string().regex(/^\d{4}$/).optional(),
  /** …or the emailed one-time code for this request. */
  request_id: z.number().int().positive().optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
});

/**
 * POST /api/pos/overrides/approve
 * Approves an override with an ADMIN's PIN (an admin ringing the sale is
 * approved without one) or the emailed one-time code. Returns a signed
 * token for exactly this (kind, ref) at this store, valid 30 minutes.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { kind, ref, pin, request_id, code } = parsed.data;
  const pool = getPool();
  const name = (r: { first_name?: string | null; last_name?: string | null; email: string }) =>
    [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email;
  const grant = (by: string) =>
    NextResponse.json({ token: signOverride({ kind, ref, lid: cashier.lid, by }), approver: by });

  if (request_id && code) {
    const r = await pool.query(
      `UPDATE pos_override_requests
          SET attempts = attempts + 1
        WHERE id = $1 AND kind = $2 AND ref = $3
          AND approved_at IS NULL AND expires_at > now() AND attempts < 5
        RETURNING id, code_hash, sent_to`,
      [request_id, kind, ref],
    );
    const row = r.rows[0];
    if (!row) {
      return NextResponse.json(
        { error: "expired", message: "That code expired or was used up — request a new one." },
        { status: 410 },
      );
    }
    if (row.code_hash !== hashOverrideCode(code, kind, ref)) {
      return NextResponse.json({ error: "bad_code", message: "Wrong code." }, { status: 401 });
    }
    await pool.query(`UPDATE pos_override_requests SET approved_at = now() WHERE id = $1`, [row.id]);
    return grant(`${row.sent_to} (emailed code)`);
  }

  if (cashier.role === "admin") {
    const me = await pool.query(`SELECT first_name, last_name, email FROM users WHERE id = $1::uuid`, [
      cashier.user_id,
    ]);
    return grant(me.rows[0] ? name(me.rows[0]) : (cashier.email ?? "Admin"));
  }
  if (!pin) return NextResponse.json({ error: "approval_required" }, { status: 401 });
  const admins = await pool.query(
    `SELECT pe.pin_hash, u.first_name, u.last_name, u.email
       FROM pos_employees pe
       JOIN users u ON u.id = pe.user_id
      WHERE pe.is_active AND pe.role = 'admin'
        AND (EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = pe.user_id AND ul.location_id = $1::uuid)
             OR NOT EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = pe.user_id))`,
    [cashier.lid],
  );
  for (const a of admins.rows) {
    if (await bcrypt.compare(pin, a.pin_hash)) return grant(name(a));
  }
  return NextResponse.json(
    { error: "bad_pin", message: "That isn't an admin PIN at this store." },
    { status: 401 },
  );
}
