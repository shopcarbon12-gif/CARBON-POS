import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const lineSchema = z.object({
  description: z.string().min(1).max(100),
  quantity: z.number().int().positive(),
  unit_amount_cents: z.number().int().nonnegative(),
});

const cartSchema = z.object({
  currency: z.string().length(3).default("usd"),
  line_items: z.array(lineSchema).max(50),
  total_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative().optional(),
});

async function readerForCurrentSession(userId: string): Promise<string | null> {
  const pool = getPool();
  const r = await pool.query(
    `SELECT reg.stripe_reader_id
       FROM pos_register_sessions s
       JOIN pos_registers reg ON reg.id = s.register_id
      WHERE s.status = 'open' AND s.opened_by = $1
      ORDER BY s.opened_at DESC LIMIT 1`,
    [userId],
  );
  return r.rows[0]?.stripe_reader_id ?? null;
}

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = cartSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const readerId = await readerForCurrentSession(cashier.user_id);
  if (!readerId) {
    return NextResponse.json({ error: "no_reader" }, { status: 409 });
  }
  try {
    await stripe().terminal.readers.setReaderDisplay(readerId, {
      type: "cart",
      cart: {
        currency: parsed.data.currency,
        line_items: parsed.data.line_items.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          amount: l.unit_amount_cents,
        })),
        total: parsed.data.total_cents,
        ...(parsed.data.tax_cents !== undefined && {
          tax: parsed.data.tax_cents,
        }),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Reader busy (mid-payment) or offline — don't fail the cashier UI.
    console.warn("[reader/display POST]", (err as Error).message);
    return NextResponse.json({ ok: false, skipped: true });
  }
}

export async function DELETE() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const readerId = await readerForCurrentSession(cashier.user_id);
  if (!readerId) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  try {
    // Stripe SDK has no clearReaderDisplay; cancelAction returns the reader
    // to its idle splash by cancelling the in-flight display action.
    await stripe().terminal.readers.cancelAction(readerId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Often 400 "no_action" when reader is already idle — treat as success.
    const msg = (err as Error).message;
    if (msg.includes("no_action") || msg.includes("already")) {
      return NextResponse.json({ ok: true, was_idle: true });
    }
    console.warn("[reader/display DELETE]", msg);
    return NextResponse.json({ ok: false, skipped: true });
  }
}
