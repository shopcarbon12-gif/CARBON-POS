import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { priceReturn, ReturnError } from "@/lib/returns";

const schema = z.object({
  sale_id: z.number().int().positive(),
  items: z
    .array(
      z.object({
        line_id: z.number().int().positive(),
        epc: z.string().max(64).nullable().optional(),
        quantity: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * POST /api/pos/returns/quote — exact credit for the pieces coming back
 * (same pricing + tag checks refunds and exchanges use), so checkout
 * shows the real amount due / to refund.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const q = await priceReturn(getPool(), {
      lid: cashier.lid,
      saleId: parsed.data.sale_id,
      items: parsed.data.items,
    });
    return NextResponse.json({
      credit: q.credit,
      tax: q.tax,
      sale_number: q.saleNumber,
      customer_id: q.customerId,
    });
  } catch (err) {
    if (err instanceof ReturnError) {
      return NextResponse.json({ error: "return_invalid", message: err.message }, { status: 422 });
    }
    throw err;
  }
}
