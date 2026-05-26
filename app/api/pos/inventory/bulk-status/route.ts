import { NextResponse } from "next/server";
import { z } from "zod";
import { currentCashier } from "@/lib/session";
import { mintWmsSessionJwt } from "@/lib/wms-session";

export const runtime = "nodejs";

const WMS_BULK_STATUS_URL =
  process.env.WMS_BASE_URL?.replace(/\/+$/, "") ?? "https://wms.shopcarbon.com";

/** Only the four target statuses exposed by the POS Update Status modal. */
const ALLOWED = new Set(["in-stock", "damaged", "stolen", "tag_killed"]);

const schema = z.object({
  epcs: z.array(z.string().min(1).max(64)).min(1).max(500),
  targetStatus: z.enum(["in-stock", "damaged", "stolen", "tag_killed"]),
  override: z.boolean().optional(),
});

/**
 * POST /api/pos/inventory/bulk-status
 *
 * POS-side proxy for WMS's POST /api/inventory/bulk-status. We mint a
 * WMS-format JWT for the signed-in cashier (HS256 over the shared
 * SESSION_SECRET — see lib/wms-session.ts) and forward the body so all
 * the role checks, super-admin gates, audit-log writes (STATUS_CHANGE
 * rows in inventory_audit_logs feeding Activity History + Inventory
 * Adjustments reports) happen WMS-side. POS never duplicates the
 * business logic — only adapts the UI layer.
 *
 * The four-status POS UI is enforced here too as a defense in depth:
 * a malicious caller can't bypass the UI to set sold/return/in-transit
 * etc., even though WMS would accept those values from the right scope.
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
  if (!ALLOWED.has(parsed.data.targetStatus)) {
    return NextResponse.json({ error: "status_not_allowed_here" }, { status: 400 });
  }

  let jwt: string;
  try {
    jwt = await mintWmsSessionJwt(cashier);
  } catch (e) {
    return NextResponse.json(
      { error: "wms_session_mint_failed", hint: e instanceof Error ? e.message : "missing tid/lid/email" },
      { status: 503 },
    );
  }

  const upstream = await fetch(`${WMS_BULK_STATUS_URL}/api/inventory/bulk-status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      epcs: parsed.data.epcs.map((e) => e.trim()).filter(Boolean),
      targetStatus: parsed.data.targetStatus,
      override: parsed.data.override === true,
      reason: "pos_update_status_modal",
    }),
    cache: "no-store",
  }).catch((e: unknown) => {
    return new Response(
      JSON.stringify({
        error: "wms_unreachable",
        hint: e instanceof Error ? e.message : String(e),
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
