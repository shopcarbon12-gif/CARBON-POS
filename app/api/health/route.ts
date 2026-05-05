import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

/**
 * Coolify health check. Returns 200 only if the shared Postgres responds.
 * GET /api/health
 */
export async function GET() {
  try {
    const pool = getPool();
    const r = await pool.query("SELECT 1 AS ok");
    if (r.rows[0]?.ok !== 1) {
      return NextResponse.json({ ok: false }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[health]", err);
    return NextResponse.json(
      { ok: false, error: "database_unreachable" },
      { status: 503 },
    );
  }
}
