import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const openSchema = z.object({
  register_id: z.number().int().positive(),
  opening_cash: z.number().nonnegative(),
});

/**
 * GET /api/pos/sessions/current
 *   → returns the currently-open session for the calling cashier, if any.
 * (Implemented as a search on the same path with ?current=1 to keep route
 * count small.)
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get("current") === "1") {
    const pool = getPool();
    const r = await pool.query(
      `SELECT s.*, r.name AS register_name, r.pos_location_id
         FROM pos_register_sessions s
         JOIN pos_registers r ON r.id = s.register_id
        WHERE s.status = 'open'
          AND s.opened_by = $1
        ORDER BY s.opened_at DESC
        LIMIT 1`,
      [cashier.user_id],
    );
    return NextResponse.json({ session: r.rows[0] ?? null });
  }
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

/**
 * POST /api/pos/sessions
 * Opens a fresh register session. Fails if the register already has one open
 * (enforced by the partial unique index on pos_register_sessions).
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = openSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const pool = getPool();
  try {
    const result = await pool.query(
      `INSERT INTO pos_register_sessions
         (register_id, opened_by, opening_cash)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [parsed.data.register_id, cashier.user_id, parsed.data.opening_cash],
    );
    return NextResponse.json({ session: result.rows[0] });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json(
        {
          error: "register_already_open",
          message:
            "This register is already open. Close the current session first.",
        },
        { status: 409 },
      );
    }
    console.error("[sessions/open]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
