import { NextResponse } from "next/server";
import { z } from "zod";
import { update } from "@/auth";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  location_id: z.string().uuid(),
});

/**
 * POST /api/pos/auth/switch-location
 * Swaps the active location on the current session — but only if the
 * caller actually has access to the requested location via
 * `user_locations`. The session JWT's `lid` and `lcode` are rewritten via
 * NextAuth's update trigger so all subsequent requests scope to the new
 * location automatically.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const pool = getPool();
  const r = await pool.query<{ id: string; code: string; name: string }>(
    `SELECT l.id::text, l.code, l.name
       FROM user_locations ul
       JOIN locations l ON l.id = ul.location_id
      WHERE ul.user_id     = $1::uuid
        AND ul.location_id = $2::uuid
        AND l.is_active    = TRUE
      LIMIT 1`,
    [cashier.user_id, parsed.data.location_id],
  );
  const target = r.rows[0];
  if (!target) {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "You don't have access to that location.",
      },
      { status: 403 },
    );
  }
  // Swap lid + lcode on the session JWT. The auth.config.ts jwt callback
  // honors `trigger === "update"` and rewrites both fields when they're
  // nested under `user`.
  await update({ user: { lid: target.id, lcode: target.code } });
  return NextResponse.json({
    location_id: target.id,
    location_code: target.code,
    location_name: target.name,
  });
}
