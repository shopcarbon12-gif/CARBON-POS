import { NextResponse } from "next/server";
import { z } from "zod";
import { currentCashier } from "@/lib/session";
import { evaluatePromotions } from "@/lib/promotions";

const schema = z.object({
  customer_id: z.number().int().positive().nullable().optional(),
  lines: z
    .array(
      z.object({
        sku_id: z.string().nullable(),
        unit_price: z.number(),
        quantity: z.number(),
        line_type: z.string(),
      }),
    )
    .max(300),
});

/**
 * POST /api/pos/promotions/evaluate — best automatic promotion per cart
 * line (lib/promotions.ts). The sell screen applies the result; capture
 * re-evaluates to verify.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const promos = await evaluatePromotions(
    cashier.lid,
    parsed.data.customer_id ?? null,
    parsed.data.lines,
  );
  return NextResponse.json({ promos });
}
