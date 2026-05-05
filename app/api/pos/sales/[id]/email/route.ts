import { NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";

const schema = z.object({ email: z.string().email() });

/**
 * POST /api/pos/sales/:id/email
 * Emails a plain-HTML receipt to the customer via Resend.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const saleId = Number(id);
  if (!Number.isFinite(saleId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "email_not_configured", message: "Email isn't set up yet." },
      { status: 503 },
    );
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.*, l.name AS location_name
       FROM pos_sales s
       JOIN pos_locations pl ON pl.id = s.pos_location_id
       JOIN locations l ON l.id = pl.wms_location_id
      WHERE s.id = $1`,
    [saleId],
  );
  const sale = r.rows[0];
  if (!sale) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const linesRes = await pool.query(
    `SELECT * FROM pos_sale_lines WHERE sale_id = $1 ORDER BY id`,
    [saleId],
  );
  const html = `
    <h2>Thanks from ${sale.location_name}!</h2>
    <p>Sale ${sale.sale_number} · ${new Date(
      sale.completed_at ?? sale.created_at,
    ).toLocaleString()}</p>
    <table cellpadding="6" cellspacing="0" border="0">
      ${linesRes.rows
        .map(
          (l) =>
            `<tr><td>${l.quantity}× ${escapeHtml(
              l.description,
            )}</td><td align="right">${formatMoney(l.line_total)}</td></tr>`,
        )
        .join("")}
      <tr><td>Subtotal</td><td align="right">${formatMoney(sale.subtotal)}</td></tr>
      <tr><td>Discount</td><td align="right">−${formatMoney(sale.discount_amount)}</td></tr>
      <tr><td>Tax</td><td align="right">${formatMoney(sale.tax_amount)}</td></tr>
      <tr><td><b>Total</b></td><td align="right"><b>${formatMoney(sale.total_amount)}</b></td></tr>
    </table>
    <p>Questions? Just reply to this email.</p>
  `;
  const resend = new Resend(apiKey);
  try {
    await resend.emails.send({
      from: process.env.RECEIPT_FROM_EMAIL || "receipts@shopcarbon.com",
      to: parsed.data.email,
      subject: `Your receipt — ${sale.sale_number}`,
      html,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[email]", err);
    return NextResponse.json(
      { error: "send_failed", message: "Couldn't send the email. Try again." },
      { status: 502 },
    );
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}
