import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { signSwitchToken, SWITCH_COOKIE } from "@/lib/switch-token";

const schema = z.object({ pin: z.string().regex(/^\d{4}$/) });

/**
 * POST /api/pos/auth/switch-prepare
 *
 * "Change employee" step. Requires a CURRENT valid session (so only an
 * already-signed-in terminal can do this) — that session proves which
 * location the terminal is authorized for. We match the PIN against an active
 * employee at that location and mint a short-lived signed cookie that the
 * NextAuth "switch" provider consumes to issue the new employee's session.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!cashier.lid) {
    return NextResponse.json({ error: "no_location" }, { status: 400 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const pin = parsed.data.pin;
  const pool = getPool();
  const r = await pool.query<{
    employee_id: number;
    user_id: string;
    role: string;
    pin_hash: string;
    email: string;
  }>(
    `SELECT pe.id AS employee_id, pe.user_id::text, pe.role, pe.pin_hash, u.email
       FROM pos_employees pe
       JOIN users u ON u.id = pe.user_id
       JOIN user_locations ul ON ul.user_id = pe.user_id
      WHERE pe.is_active = TRUE AND ul.location_id = $1::uuid
      ORDER BY pe.id ASC`,
    [cashier.lid],
  );
  let matched: (typeof r.rows)[number] | null = null;
  for (const row of r.rows) {
    if (await bcrypt.compare(pin, row.pin_hash)) {
      matched = row;
      break;
    }
  }
  if (!matched) {
    return NextResponse.json(
      { error: "bad_pin", message: "That PIN didn't match an employee at this location." },
      { status: 401 },
    );
  }

  const token = signSwitchToken({
    user_id: matched.user_id,
    email: matched.email,
    employee_id: matched.employee_id,
    role: matched.role,
    tid: cashier.tid,
    lid: cashier.lid,
    lcode: cashier.lcode,
  });
  const res = NextResponse.json({ ok: true, lcode: cashier.lcode });
  res.cookies.set(SWITCH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60,
  });
  return res;
}
