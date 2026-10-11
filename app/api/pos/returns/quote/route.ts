import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { priceReturn, ReturnError } from "@/lib/returns";
import { cardDetails } from "@/lib/receipt-pdf";

const METHOD_LABEL: Record<string, string> = {
  card: "Card",
  cash: "Cash",
  store_credit: "Store credit",
  gift_card: "Gift card",
  account: "Account",
  check: "Check",
};

const schema = z.object({
  sale_id: z.number().int().positive(),
  items: z
    .array(
      z.object({
        line_id: z.number().int().positive(),
        epc: z.string().max(64).nullable().optional(),
        quantity: z.number().int().positive().optional(),
        override_token: z.string().max(2000).nullable().optional(),
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
    // How the original sale was paid, so the cashier refunds the same way.
    const pay = await getPool().query<{
      method: string;
      amount: string;
      stripe_payment_intent_id: string | null;
    }>(
      `SELECT method, amount, stripe_payment_intent_id
         FROM pos_payments
        WHERE sale_id = $1 AND status IN ('completed','refunded')
        ORDER BY id`,
      [parsed.data.sale_id],
    );
    const payments = await Promise.all(
      pay.rows.map(async (p) => ({
        method: p.method,
        amount: Number(p.amount),
        label:
          (p.method === "card" ? await cardDetails(p.stripe_payment_intent_id) : null) ??
          METHOD_LABEL[p.method] ??
          p.method,
      })),
    );
    return NextResponse.json({
      payments,
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
