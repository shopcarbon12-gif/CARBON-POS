import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { hashAgentToken, newAgentToken } from "@/lib/print-queue";

async function guard(ctx: { params: Promise<{ id: string }> }) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id)) {
    return { error: NextResponse.json({ error: "bad_id" }, { status: 400 }) };
  }
  return { id };
}

/**
 * POST /api/pos/locations/:id/print-agent
 * Creates (or replaces) the store's print-agent key. The plain key is
 * returned exactly once — only its hash is stored. Replacing it
 * disconnects the old agent.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  const token = newAgentToken();
  const r = await getPool().query(
    `UPDATE pos_locations
        SET print_agent_token_hash = $2,
            print_agent_last_seen_at = NULL,
            print_agent_info = NULL
      WHERE id = $1
      RETURNING id`,
    [g.id, hashAgentToken(token)],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ token });
}

/** DELETE — revoke the key; printing falls back to browser → printer. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  await getPool().query(
    `UPDATE pos_locations
        SET print_agent_token_hash = NULL,
            print_agent_last_seen_at = NULL,
            print_agent_info = NULL
      WHERE id = $1`,
    [g.id],
  );
  return NextResponse.json({ ok: true });
}
