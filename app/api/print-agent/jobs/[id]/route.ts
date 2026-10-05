import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { agentLocationFromRequest } from "@/lib/print-queue";

/**
 * POST /api/print-agent/jobs/:id   (Authorization: Bearer <agent key>)
 * Body: { ok: boolean, error?: string }
 * The agent reports whether the bytes reached the printer.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const loc = await agentLocationFromRequest(req);
  if (!loc) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    ok?: unknown;
    error?: unknown;
  };
  const ok = body.ok === true;
  const error =
    typeof body.error === "string" ? body.error.slice(0, 500) : null;
  await getPool().query(
    `UPDATE pos_print_jobs
        SET status = $3, error = $4, finished_at = now()
      WHERE id = $1 AND pos_location_id = $2`,
    [jobId, loc.id, ok ? "printed" : "failed", ok ? null : error ?? "print failed"],
  );
  return NextResponse.json({ ok: true });
}
