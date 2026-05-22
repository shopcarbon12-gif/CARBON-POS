"use client";

import { useMemo, type CSSProperties } from "react";
import { formatMoney } from "@/lib/utils";
import { ean13Display } from "@/lib/barcode";
import { renderBarcodeSvg } from "@/lib/barcode-browser";

type SaleHeader = {
  sale_number: string;
  location_name: string;
  register_name: string;
  cashier_email: string;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  tax_rate?: string | number | null;
  total_amount: string;
  completed_at: string | null;
  created_at: string;
  return_policy: string | null;
  receipt_footer?: string | null;
  receipt_header?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_store_credit_balance?: string | number | null;
};

type LineRow = {
  id: number;
  description: string;
  quantity: number;
  line_total: string;
};

type PaymentRow = {
  id: number;
  method: "card" | "cash" | "check" | "store_credit" | string;
  amount: string;
  change_given?: string | null;
};

type LoyaltyFooter = {
  is_member: boolean;
  points: number;
  dollar_value: number;
};

/**
 * Port of carbon_receipt_barcode_more_short_height.html. Width is locked
 * to 80mm to match thermal-paper proportions; all spacing uses the same
 * mm dimensions as the reference so the on-screen preview lays out
 * identically to what the printer will emit.
 */
export function ReceiptView({
  sale,
  lines,
  payments,
  loyalty,
}: {
  sale: SaleHeader;
  lines: LineRow[];
  payments: PaymentRow[];
  loyalty?: LoyaltyFooter;
}) {
  const cityLine = [sale.city, sale.state, sale.zip].filter(Boolean).join(", ");
  const discount = Number(sale.discount_amount);
  const taxRate = sale.tax_rate != null ? Number(sale.tax_rate) : null;
  const taxAmount = Number(sale.tax_amount);
  const taxBase =
    taxRate && taxRate > 0 ? Math.round((taxAmount / taxRate) * 100) / 100 : null;
  const customerName = [sale.customer_first_name, sale.customer_last_name]
    .filter(Boolean)
    .join(" ");
  const storeCredit =
    sale.customer_store_credit_balance != null
      ? Number(sale.customer_store_credit_balance)
      : null;

  // Render the barcode as a data-URI <img> exactly like the reference
  // HTML. Letting the browser size an <img> via CSS keeps it inside the
  // 62mm box; the SVG's own digit labels (includetext:true) act as the
  // human-readable line under the bars — we don't duplicate them.
  const barcodeDataUri = useMemo(() => {
    const svg = renderBarcodeSvg(sale.sale_number, { heightMm: 12, scale: 2 });
    const base64 =
      typeof window === "undefined"
        ? Buffer.from(svg, "utf-8").toString("base64")
        : window.btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${base64}`;
  }, [sale.sale_number]);

  return (
    <div style={S.page}>
      <main style={S.receipt}>
        <header style={S.center}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="Carbon logo" style={S.logo} />

          <div style={S.address}>
            {sale.address_line1 && (
              <>
                {sale.address_line1}
                <br />
              </>
            )}
            {sale.address_line2 && (
              <>
                {sale.address_line2}
                <br />
              </>
            )}
            {cityLine && (
              <>
                {cityLine}
                <br />
              </>
            )}
            United States
            {sale.phone && (
              <>
                <br />
                {sale.phone}
              </>
            )}
          </div>

          <div style={S.title}>Sales Receipt</div>
          <div style={S.date}>
            {new Date(sale.completed_at ?? sale.created_at).toLocaleString()}
          </div>
        </header>

        <section style={S.info}>
          <InfoRow label="Ticket:" value={sale.sale_number} />
          <InfoRow label="Register:" value={sale.register_name} />
          <InfoRow label="Employee:" value={sale.cashier_email} />
          {customerName && <InfoRow label="Customer:" value={customerName} />}
        </section>

        <section>
          <div style={S.itemsHeader}>
            <span>ITEMS</span>
            <span style={S.alignRight}>#</span>
            <span style={S.alignRight}>PRICE</span>
          </div>

          {lines.map((l) => (
            <div key={l.id} style={S.itemRow}>
              <span style={S.itemName}>{splitItemName(l.description)}</span>
              <span style={S.alignRight}>{l.quantity}</span>
              <span style={S.alignRight}>{formatMoney(l.line_total)}</span>
            </div>
          ))}

          <div style={S.totals}>
            <Row label="Fee total" value={formatMoney(0)} />
            <Row label="Subtotal" value={formatMoney(sale.subtotal)} />
            {discount > 0 && (
              <Row
                label="Discount"
                value={`-${formatMoney(sale.discount_amount)}`}
              />
            )}
            <Row
              label={
                taxRate && taxBase != null
                  ? `Tax (${formatMoney(taxBase)} @ ${(taxRate * 100).toFixed(2)}%)`
                  : "Tax"
              }
              value={formatMoney(sale.tax_amount)}
            />
            <Row label="Total Tax" value={formatMoney(sale.tax_amount)} />
            <Row
              label="Total"
              value={formatMoney(sale.total_amount)}
              total
            />
          </div>
        </section>

        <Section title="PAYMENTS">
          <div style={S.payments}>
            {payments.map((p) => (
              <div key={p.id}>
                <Row label={humanMethod(p.method)} value={formatMoney(p.amount)} />
                {p.method === "cash" && Number(p.change_given || 0) > 0 ? (
                  <Row
                    label="Change"
                    value={formatMoney(p.change_given)}
                    muted
                  />
                ) : null}
              </div>
            ))}
          </div>
        </Section>

        {storeCredit != null && storeCredit !== 0 && (
          <Section title="STORE ACCOUNT">
            <div style={S.payments}>
              <Row label="On Deposit:" value={formatMoney(storeCredit)} />
            </div>
          </Section>
        )}

        <section style={S.policy}>
          <div style={S.policyMain}>
            {(sale.return_policy ?? "NO REFUNDS — EXCHANGE ONLY")
              .split("\n")[0]}
          </div>
          {(sale.return_policy ?? "")
            .split("\n")
            .slice(1)
            .map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          {!sale.return_policy && (
            <>
              Exchanges accepted within 14 days of purchase.
              <br />
              Items must be unworn, unused, with original tags attached,
              <br />
              and accompanied by the original receipt.
            </>
          )}
        </section>

        <div style={S.thanks}>
          {sale.receipt_footer ??
            (customerName ? `Thank You ${customerName}!` : "Thank You!")}
        </div>

        <div style={S.barcodeWrap}>
          <div style={S.barcodeBox}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={barcodeDataUri}
              alt={`Barcode ${ean13Display(sale.sale_number)}`}
              style={S.barcode}
            />
          </div>
        </div>

        {loyalty && loyalty.points > 0 && (
          <section style={S.transaction}>
            <div style={S.sectionTitle}>
              {loyalty.is_member ? "CARBON REWARDS" : "JOIN CARBON REWARDS"}
            </div>
            {loyalty.is_member ? (
              <>
                <div style={S.txnRow}>
                  <span>Points earned</span>
                  <span style={S.txnValue}>{loyalty.points}</span>
                </div>
                <div style={S.txnRow}>
                  <span>Approx. cashback</span>
                  <span style={S.txnValue}>
                    {formatMoney(loyalty.dollar_value)}
                  </span>
                </div>
              </>
            ) : (
              <div style={S.rewardOffer}>
                You would have earned <b>{loyalty.points} pts</b> (~
                {formatMoney(loyalty.dollar_value)}). Ask the cashier to enroll
                on your next visit and start saving!
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

/** "LOAGAN DENIM SHORTS - BLUE WASHED 38" → two lines. */
function splitItemName(desc: string): React.ReactNode {
  // Common separators we see in cart descriptions: " - ", " — ", "\n",
  // or " / ". Anything else renders as a single line.
  const match = desc.match(/^(.*?)\s*[\-—/\n]\s*(.+)$/);
  if (!match) return desc;
  return (
    <>
      <span style={S.productTitle}>{match[1]}</span>
      <br />
      <span style={S.productDetail}>{match[2]}</span>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={S.section}>
      <div style={S.sectionTitle}>{title}</div>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.infoRow}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Row({
  label,
  value,
  total = false,
  muted = false,
}: {
  label: string;
  value: string;
  total?: boolean;
  muted?: boolean;
}) {
  return (
    <div style={total ? S.rowTotal : muted ? S.rowMuted : S.row}>
      <span>{label}</span>
      <span style={S.alignRight}>{value}</span>
    </div>
  );
}

function humanMethod(m: string): string {
  return (
    {
      card: "Credit Card",
      cash: "Cash",
      check: "Check",
      store_credit: "Store credit",
      account: "Account",
      gift_card: "Gift card",
    }[m] ?? m
  );
}

const FONT = "Arial, Helvetica, sans-serif";

const S: Record<string, CSSProperties> = {
  page: {
    background: "#e9e9e9",
    padding: 24,
    display: "flex",
    justifyContent: "center",
    color: "#000",
    fontFamily: FONT,
  },
  receipt: {
    width: "80mm",
    background: "#fff",
    padding: "6mm 4mm 5mm",
    boxShadow: "0 8px 28px rgba(0,0,0,.16)",
    fontSize: 12,
    lineHeight: 1.22,
    boxSizing: "border-box",
  },
  center: {
    textAlign: "center",
  },
  logo: {
    width: "52mm",
    maxWidth: "100%",
    height: "auto",
    display: "block",
    margin: "0 auto 1.5mm",
  },
  address: {
    fontSize: 11,
    lineHeight: 1.08,
    marginTop: 0,
  },
  title: {
    marginTop: "4mm",
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: ".25px",
  },
  date: {
    fontSize: 11,
    marginTop: ".5mm",
  },
  info: {
    marginTop: "5mm",
    fontSize: 12,
    lineHeight: 1.28,
  },
  infoRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "1.5mm",
  },
  itemsHeader: {
    marginTop: "4mm",
    display: "grid",
    gridTemplateColumns: "1fr 11mm 18mm",
    borderBottom: "1px solid #000",
    fontWeight: 800,
    fontSize: 12,
    paddingBottom: ".7mm",
  },
  itemRow: {
    display: "grid",
    gridTemplateColumns: "1fr 9mm 17mm",
    borderBottom: "1px solid #000",
    padding: ".8mm 0 1mm",
    fontSize: 11,
    lineHeight: 1.15,
  },
  itemName: {
    fontWeight: 800,
    letterSpacing: ".15px",
  },
  productTitle: {
    whiteSpace: "nowrap",
  },
  productDetail: {
    whiteSpace: "nowrap",
  },
  totals: {
    marginTop: ".8mm",
    marginLeft: "28mm",
    fontSize: 12,
    lineHeight: 1.45,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    columnGap: "4mm",
    alignItems: "baseline",
  },
  rowMuted: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    columnGap: "4mm",
    alignItems: "baseline",
    color: "rgba(0,0,0,.6)",
  },
  rowTotal: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    columnGap: "4mm",
    alignItems: "baseline",
    fontSize: 13,
    fontWeight: 900,
  },
  section: {
    marginTop: "5mm",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: ".9px",
    borderBottom: "1px solid #000",
    paddingBottom: ".6mm",
  },
  payments: {
    fontSize: 12,
    lineHeight: 1.45,
    marginTop: ".8mm",
    marginLeft: "31mm",
  },
  rewardOffer: {
    fontSize: 11,
    lineHeight: 1.35,
    marginTop: "1mm",
  },
  transaction: {
    marginTop: "4mm",
    fontSize: 11,
    lineHeight: 1.35,
  },
  txnRow: {
    display: "grid",
    gridTemplateColumns: "22mm 1fr",
    columnGap: "2mm",
  },
  txnValue: {
    textAlign: "right",
    wordBreak: "break-word",
  },
  policy: {
    marginTop: "5mm",
    textAlign: "center",
    fontSize: 13,
    lineHeight: 1.15,
    letterSpacing: ".3px",
  },
  policyMain: {
    fontSize: 14,
    letterSpacing: ".7px",
  },
  thanks: {
    marginTop: "4mm",
    textAlign: "center",
    fontSize: 12,
  },
  barcodeWrap: {
    marginTop: "4mm",
    textAlign: "center",
  },
  barcodeBox: {
    display: "inline-block",
    background: "#fff",
    padding: 0,
    border: 0,
  },
  barcode: {
    width: "62mm",
    maxWidth: "100%",
    height: "auto",
    maxHeight: "18mm",
    display: "block",
    imageRendering: "crisp-edges",
    objectFit: "contain",
  },
  alignRight: {
    textAlign: "right",
  },
};

export { humanMethod };
