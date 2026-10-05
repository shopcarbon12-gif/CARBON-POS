import { NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { currentCashier } from "@/lib/session";
import { BUSINESS_NAME, loadReceiptData, renderReceiptPdf } from "@/lib/receipt-pdf";

const schema = z.object({ email: z.string().email() });

/**
 * POST /api/pos/sales/:id/email
 * Emails the customer a short thank-you note with the full receipt
 * attached as a PDF (lib/receipt-pdf.ts), via Resend.
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
  const data = await loadReceiptData(saleId, cashier.lid);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const pdf = await renderReceiptPdf(data);

  const firstName = data.customer?.name?.split(" ")[0] ?? null;
  const date = new Date(data.sale.at).toLocaleDateString("en-US", {
    timeZone: data.store.timezone,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111;">
        <tr><td style="background:#000000;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.5px;">${BUSINESS_NAME}</td></tr>
        <tr><td style="padding:28px;font-size:15px;line-height:1.55;">
          <p style="margin:0 0 14px;">${greeting}</p>
          <p style="margin:0 0 14px;">Thank you for shopping with ${BUSINESS_NAME}. Your receipt for purchase <b>#${escapeHtml(data.sale.sale_number)}</b> on ${date} is attached as a PDF.</p>
          <p style="margin:0;">Questions about your order? Just reply to this email.</p>
        </td></tr>
        <tr><td style="padding:0 28px 24px;font-size:12px;color:#6b6b72;">${escapeHtml(data.store.name)}${data.store.phone ? ` &middot; ${escapeHtml(data.store.phone)}` : ""}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const text = [
    firstName ? `Hi ${firstName},` : "Hi,",
    "",
    `Thank you for shopping with ${BUSINESS_NAME}. Your receipt for purchase #${data.sale.sale_number} on ${date} is attached as a PDF.`,
    "",
    "Questions about your order? Just reply to this email.",
    "",
    `${BUSINESS_NAME} - ${data.store.name}`,
  ].join("\n");

  const fromAddr = process.env.RECEIPT_FROM_EMAIL?.trim() || "receipts@shopcarbon.com";
  const from = fromAddr.includes("<") ? fromAddr : `${BUSINESS_NAME} <${fromAddr}>`;

  const resend = new Resend(apiKey);
  try {
    // The Resend SDK reports a rejected send in `error` rather than
    // throwing — without this check a failed receipt looked "sent".
    const { error } = await resend.emails.send({
      from,
      to: parsed.data.email,
      subject: `Your ${BUSINESS_NAME} receipt #${data.sale.sale_number}`,
      html,
      text,
      attachments: [
        {
          filename: `Carbon-Jeans-receipt-${data.sale.sale_number}.pdf`,
          content: Buffer.from(pdf),
        },
      ],
    });
    if (error) throw new Error(`${error.name}: ${error.message}`);
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
