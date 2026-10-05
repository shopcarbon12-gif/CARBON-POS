import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { getPool } from "@/lib/db";
import { computeEarn } from "@/lib/loyalty-earn";
import { renderBarcodePng } from "@/lib/barcode-node";
import { stripe } from "@/lib/stripe-terminal";
import { returnPolicyOf } from "@/lib/return-policy";

/**
 * Customer-facing PDF receipt (attached to the receipt email, also
 * downloadable from the receipt screen). Letter size, one page for a
 * normal sale, more pages for very long ones.
 */

export const BUSINESS_NAME = "Carbon Jeans Company";

export type ReceiptData = {
  sale: {
    id: number;
    sale_number: string;
    status: string;
    at: string;
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    tax_rate: number | null;
  };
  store: {
    name: string;
    address: string[];
    phone: string | null;
    timezone: string;
    return_policy: string | null;
    footer: string | null;
  };
  register: string;
  cashier: string;
  customer: {
    name: string | null;
    email: string | null;
    store_credit: number | null;
  } | null;
  lines: Array<{
    title: string;
    detail: string;
    qty: number;
    price: number;
    discount: number;
    amount: number;
    loyalty: boolean;
    taxed: boolean;
  }>;
  payments: Array<{ label: string; amount: number; extra: string | null }>;
  refunded: number;
  loyalty_points: number | null;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

const METHOD: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  check: "Check",
  store_credit: "Store Credit",
  account: "Credit Account",
  gift_card: "Gift Card",
};

/** Load everything the PDF needs for one sale at the cashier's store. */
export async function loadReceiptData(
  saleId: number,
  lid: string,
): Promise<ReceiptData | null> {
  const pool = getPool();
  const sr = await pool.query(
    `SELECT s.*, l.name AS location_name,
            pl.address_line1, pl.address_line2, pl.city, pl.state, pl.zip,
            pl.phone, pl.tax_rate AS location_tax_rate,
            COALESCE(pl.timezone, 'America/New_York') AS timezone,
            pl.return_policy, pl.receipt_footer,
            r.name AS register_name,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS cashier_name,
            c.first_name AS c_first, c.last_name AS c_last, c.email AS c_email,
            c.store_credit_balance AS c_credit,
            (SELECT COALESCE(SUM(amount),0) FROM pos_refunds WHERE original_sale_id = s.id) AS refunded
       FROM pos_sales s
       JOIN pos_locations pl ON pl.id = s.pos_location_id
       JOIN locations l      ON l.id = pl.wms_location_id
       JOIN pos_registers r  ON r.id = s.register_id
       LEFT JOIN pos_employees pe ON pe.id = s.cashier_id
       LEFT JOIN users u          ON u.id = pe.user_id
       LEFT JOIN pos_customers c  ON c.id = s.customer_id
      WHERE s.id = $1 AND pl.wms_location_id = $2::uuid`,
    [saleId, lid],
  );
  const s = sr.rows[0];
  if (!s) return null;

  const [linesR, payR] = await Promise.all([
    pool.query(
      `SELECT sl.*, cs.sku, cs.color_code, cs.size, m.description AS product
         FROM pos_sale_lines sl
         LEFT JOIN custom_skus cs ON cs.id = sl.sku_id
         LEFT JOIN matrices m     ON m.id = cs.matrix_id
        WHERE sl.sale_id = $1
        ORDER BY sl.id`,
      [saleId],
    ),
    pool.query(
      `SELECT * FROM pos_payments
        WHERE sale_id = $1 AND status IN ('completed','refunded')
        ORDER BY id`,
      [saleId],
    ),
  ]);

  const lines = linesR.rows.map((l) => {
    const loyalty = l.line_type === "loyalty_redemption";
    const qty = n(l.quantity);
    const price = n(l.unit_price);
    const discount = n(l.discount_amount);
    const variant = [l.color_code, l.size].filter(Boolean).join(" / ");
    return {
      title: loyalty
        ? "Loyalty reward"
        : String(l.product ?? l.description ?? "Item"),
      detail: loyalty
        ? String(l.description ?? "")
        : [l.sku ? `SKU ${l.sku}` : null, variant || null]
            .filter(Boolean)
            .join("  |  "),
      qty,
      price,
      discount,
      amount: Math.round((price * qty - discount) * 100) / 100,
      loyalty,
      taxed: n(l.tax_amount) > 0,
    };
  });

  const payments = await Promise.all(
    payR.rows.map(async (p) => {
      let label = METHOD[p.method] ?? p.method;
      let extra: string | null = null;
      if (p.method === "card") {
        const card = await cardDetails(p.stripe_payment_intent_id);
        if (card) label = card;
      } else if (p.method === "cash" && p.cash_given != null) {
        extra = `Tendered ${money(n(p.cash_given))}  |  Change ${money(n(p.change_given))}`;
      } else if (p.method === "check" && p.check_number) {
        extra = `Check #${p.check_number}`;
      }
      return { label, amount: n(p.amount), extra };
    }),
  );

  const giftCardValue = linesR.rows
    .filter((l) => l.line_type === "gift_card")
    .reduce((a, l) => a + n(l.unit_price) * n(l.quantity), 0);
  const earn =
    s.customer_id != null
      ? computeEarn({
          subtotal: s.subtotal,
          discount: s.discount_amount,
          gift_card_value: giftCardValue,
        })
      : null;

  const cityLine = [s.city, [s.state, s.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const customerName = [s.c_first, s.c_last].filter(Boolean).join(" ");

  return {
    sale: {
      id: s.id,
      sale_number: s.sale_number,
      status: s.status,
      at: new Date(s.completed_at ?? s.created_at).toISOString(),
      subtotal: n(s.subtotal),
      discount: n(s.discount_amount),
      tax: n(s.tax_amount),
      total: n(s.total_amount),
      tax_rate: s.location_tax_rate != null ? n(s.location_tax_rate) : null,
    },
    store: {
      name: s.location_name,
      address: [s.address_line1, s.address_line2, cityLine].filter(Boolean),
      phone: s.phone ?? null,
      timezone: s.timezone,
      return_policy: returnPolicyOf(s.return_policy),
      footer: s.receipt_footer ?? null,
    },
    register: s.register_name,
    cashier: s.cashier_name ?? "",
    customer:
      s.customer_id != null
        ? {
            name: customerName || null,
            email: s.c_email ?? null,
            store_credit: s.c_credit != null ? n(s.c_credit) : null,
          }
        : null,
    lines,
    payments,
    refunded: n(s.refunded),
    loyalty_points: earn ? earn.points : null,
  };
}

/** "Visa •••• 4242" from the Stripe charge, or null if unavailable. */
export async function cardDetails(intentId: string | null): Promise<string | null> {
  if (!intentId) return null;
  try {
    const pi = await Promise.race([
      stripe().paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    const charge =
      pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const d = charge?.payment_method_details;
    const c = d?.card_present ?? d?.card ?? d?.interac_present ?? null;
    if (!c?.last4) return null;
    const brand = String(c.brand ?? "Card");
    return `${brand.charAt(0).toUpperCase()}${brand.slice(1)} •••• ${c.last4}`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* rendering                                                            */
/* ------------------------------------------------------------------ */

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;
const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.85, 0.85, 0.87);
const BAND = rgb(0.95, 0.95, 0.96);

function money(v: number): string {
  const s = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.abs(v),
  );
  return v < 0 ? `-${s}` : s;
}

export async function renderReceiptPdf(d: ReceiptData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${BUSINESS_NAME} receipt ${d.sale.sale_number}`);
  pdf.setAuthor(BUSINESS_NAME);
  pdf.setCreator(BUSINESS_NAME);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const safe = (t: string) =>
    Array.from(t.replace(/−/g, "-"))
      .map((ch) => (charset.has(ch.codePointAt(0)!) ? ch : "?"))
      .join("");

  let logo: PDFImage | null = null;
  try {
    logo = await pdf.embedJpg(await readFile(path.join(process.cwd(), "public", "logo.jpg")));
  } catch {
    logo = null;
  }
  let barcode: PDFImage | null = null;
  try {
    barcode = await pdf.embedPng(await renderBarcodePng(d.sale.sale_number, { scale: 3, heightMm: 8 }));
  } catch {
    barcode = null;
  }

  const tz = d.store.timezone;
  const when = new Date(d.sale.at);
  const dateStr = when.toLocaleDateString("en-US", {
    timeZone: tz,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = when.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const text = (
    t: string,
    x: number,
    yy: number,
    o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {},
  ) => {
    const f = o.f ?? font;
    const size = o.size ?? 10;
    const s = safe(t);
    const w = f.widthOfTextAtSize(s, size);
    const xx = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    page.drawText(s, { x: xx, y: yy, size, font: f, color: o.color ?? INK });
  };
  const wrap = (t: string, f: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const raw of t.split(/\r?\n/)) {
      const para = safe(raw);
      let line = "";
      for (const word of para.split(/\s+/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(tryLine, size) > width && line) {
          out.push(line);
          line = word;
        } else {
          line = tryLine;
        }
      }
      out.push(line);
    }
    return out;
  };
  const rule = (yy: number, color = RULE, thickness = 0.75) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: PAGE_W - M, y: yy }, thickness, color });
  /** Start a new page when `space` doesn't fit; repeat the item table
   *  header only while items are still being listed. */
  const ensure = (space: number, withHeader = false) => {
    if (y - space < M + 40) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
      text(`${BUSINESS_NAME}  |  Receipt ${d.sale.sale_number} (continued)`, M, y, { size: 9, color: MUTED });
      y -= 24;
      if (withHeader) tableHeader();
    }
  };

  /* ---- header ---- */
  const logoSize = 64;
  if (logo) page.drawImage(logo, { x: M, y: y - logoSize, width: logoSize, height: logoSize });
  const hx = M + (logo ? logoSize + 16 : 0);
  text(BUSINESS_NAME, hx, y - 18, { f: bold, size: 18 });
  let ay = y - 33;
  for (const line of [...d.store.address, d.store.phone ?? ""].filter(Boolean)) {
    text(line, hx, ay, { size: 9, color: MUTED });
    ay -= 11.5;
  }
  text("RECEIPT", PAGE_W - M, y - 18, { f: bold, size: 22, align: "right" });
  text(`No. ${d.sale.sale_number}`, PAGE_W - M, y - 35, { f: bold, size: 10, align: "right" });
  text(dateStr, PAGE_W - M, y - 49, { size: 9, color: MUTED, align: "right" });
  text(timeStr, PAGE_W - M, y - 60.5, { size: 9, color: MUTED, align: "right" });
  y = Math.min(y - logoSize, ay) - 14;
  rule(y, INK, 1.2);
  y -= 22;

  /* ---- details ---- */
  const col2 = M + 190;
  const col3 = M + 360;
  const label = (t: string, x: number) => text(t.toUpperCase(), x, y, { f: bold, size: 7.5, color: MUTED });
  label("Store", M);
  label("Served by", col2);
  if (d.customer) label("Customer", col3);
  y -= 13;
  text(d.store.name, M, y, { size: 10 });
  text(d.cashier, col2, y, { size: 10 });
  if (d.customer) text(d.customer.name ?? d.customer.email ?? "Member", col3, y, { size: 10 });
  y -= 12;
  text(d.register, M, y, { size: 9, color: MUTED });
  if (d.customer?.name && d.customer.email) text(d.customer.email, col3, y, { size: 9, color: MUTED });
  y -= 26;

  /* ---- items ---- */
  const cQty = PAGE_W - M - 250;
  const cPrice = PAGE_W - M - 170;
  const cDisc = PAGE_W - M - 85;
  const cAmt = PAGE_W - M;
  function tableHeader() {
    page.drawRectangle({ x: M, y: y - 6, width: PAGE_W - 2 * M, height: 20, color: BAND });
    const h = (t: string, x: number, align: "left" | "right") =>
      text(t.toUpperCase(), x, y, { f: bold, size: 7.5, color: MUTED, align });
    h("Item", M + 8, "left");
    h("Qty", cQty, "right");
    h("Price", cPrice, "right");
    h("Discount", cDisc, "right");
    h("Amount", cAmt - 8, "right");
    y -= 24;
  }
  tableHeader();

  for (const l of d.lines) {
    const titleLines = wrap(l.title, bold, 10, cQty - M - 40);
    ensure(14 * titleLines.length + 14, true);
    const top = y;
    titleLines.forEach((tl, i) => text(tl, M + 8, top - i * 12.5, { f: bold, size: 10 }));
    if (!l.loyalty) {
      text(String(l.qty), cQty, top, { size: 10, align: "right" });
      text(money(l.price), cPrice, top, { size: 10, align: "right" });
      text(l.discount > 0 ? `-${money(l.discount)}` : "", cDisc, top, { size: 10, align: "right" });
    }
    text(money(l.amount), cAmt - 8, top, { f: bold, size: 10, align: "right" });
    y = top - titleLines.length * 12.5;
    if (l.detail) {
      text(l.detail, M + 8, y + 1, { size: 8.5, color: MUTED });
      y -= 11;
    }
    y -= 8;
    rule(y + 4);
    y -= 8;
  }

  /* ---- totals + payments (kept together on one page) ---- */
  const paymentsH =
    (d.payments.length ? 20 : 0) +
    d.payments.reduce((a, p) => a + 13 + (p.extra ? 13 : 0), 0) +
    (d.refunded > 0 ? 19 : 0);
  ensure(95 + paymentsH);
  y -= 4;
  const tl = PAGE_W - M - 230;
  const total = (k: string, v: string, strong = false) => {
    text(k, tl, y, { f: strong ? bold : font, size: strong ? 13 : 10, color: strong ? INK : MUTED });
    text(v, cAmt - 8, y, { f: strong ? bold : font, size: strong ? 13 : 10, align: "right" });
    y -= strong ? 20 : 15;
  };
  total("Subtotal", money(d.sale.subtotal));
  if (d.sale.discount > 0) total("Discounts", `-${money(d.sale.discount)}`);
  const taxBase = d.lines.filter((l) => l.taxed).reduce((a, l) => a + l.amount, 0);
  const pct =
    d.sale.tax_rate && d.sale.tax_rate > 0
      ? ` (${(d.sale.tax_rate * 100).toFixed(2).replace(/\.?0+$/, "")}%${
          taxBase > 0 ? ` on ${money(taxBase)}` : ""
        })`
      : "";
  total(`Sales tax${pct}`, money(d.sale.tax));
  y += 4;
  page.drawLine({ start: { x: tl, y: y + 6 }, end: { x: PAGE_W - M, y: y + 6 }, thickness: 1, color: INK });
  y -= 10;
  total("Total", money(d.sale.total), true);

  /* ---- payments ---- */
  if (d.payments.length) {
    y -= 6;
    text("PAYMENT", tl, y, { f: bold, size: 7.5, color: MUTED });
    y -= 14;
    for (const p of d.payments) {
      text(p.label, tl, y, { size: 10 });
      text(money(p.amount), cAmt - 8, y, { size: 10, align: "right" });
      y -= 13;
      if (p.extra) {
        text(p.extra, tl, y, { size: 8.5, color: MUTED });
        y -= 13;
      }
    }
  }
  if (d.refunded > 0) {
    y -= 4;
    text("Refunded", tl, y, { f: bold, size: 10 });
    text(`-${money(d.refunded)}`, cAmt - 8, y, { f: bold, size: 10, align: "right" });
    y -= 15;
  }

  /* ---- rewards / account ---- */
  const notes: string[] = [];
  if (d.loyalty_points && d.loyalty_points > 0) {
    notes.push(`You earned ${d.loyalty_points} Carbon Rewards points on this purchase.`);
  }
  if (d.customer?.store_credit && d.customer.store_credit > 0) {
    notes.push(`Store credit balance: ${money(d.customer.store_credit)}`);
  }
  if (notes.length) {
    y -= 12;
    ensure(20 + notes.length * 14);
    const boxH = 14 + notes.length * 14;
    page.drawRectangle({ x: M, y: y - boxH + 12, width: PAGE_W - 2 * M, height: boxH, color: BAND });
    for (const nt of notes) {
      text(nt, M + 12, y, { size: 10 });
      y -= 14;
    }
    y -= 6;
  }

  /* ---- return policy (headline + body) + footer ---- */
  if (d.store.return_policy) {
    const [head, ...rest] = d.store.return_policy.split("\n");
    const body = wrap(rest.join(" "), font, 9, PAGE_W - 2 * M - 24);
    const foot = d.store.footer ? wrap(d.store.footer, font, 9, PAGE_W - 2 * M - 24) : [];
    const boxH = 34 + body.length * 12 + (foot.length ? 8 + foot.length * 12 : 0);
    y -= 18;
    ensure(boxH + 10);
    page.drawRectangle({
      x: M,
      y: y - boxH + 14,
      width: PAGE_W - 2 * M,
      height: boxH,
      borderColor: INK,
      borderWidth: 1,
    });
    text(head, PAGE_W / 2, y - 4, { f: bold, size: 11, align: "center" });
    y -= 20;
    for (const line of body) {
      text(line, PAGE_W / 2, y, { size: 9, color: MUTED, align: "center" });
      y -= 12;
    }
    if (foot.length) {
      y -= 8;
      for (const line of foot) {
        text(line, PAGE_W / 2, y, { size: 9, align: "center" });
        y -= 12;
      }
    }
    y -= 4;
  }

  y -= 22;
  ensure(90);
  if (barcode) {
    const bw = 140;
    const bh = (barcode.height / barcode.width) * bw;
    page.drawImage(barcode, { x: (PAGE_W - bw) / 2, y: y - bh, width: bw, height: bh });
    y -= bh + 16;
  }
  text(`Thank you for shopping with ${BUSINESS_NAME}.`, PAGE_W / 2, y, {
    f: bold,
    size: 10,
    align: "center",
  });

  // Page numbers when the receipt runs long.
  const pages = pdf.getPages();
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const s = `Page ${i + 1} of ${pages.length}`;
      p.drawText(s, {
        x: PAGE_W - M - font.widthOfTextAtSize(s, 8),
        y: 28,
        size: 8,
        font,
        color: MUTED,
      });
    });
  }

  return pdf.save();
}
