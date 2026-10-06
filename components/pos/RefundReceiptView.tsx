"use client";

import { useMemo, type CSSProperties } from "react";
import { formatMoney } from "@/lib/utils";
import { renderBarcodeSvg } from "@/lib/barcode-browser";

export type RefundReceiptData = {
  refund: {
    id: number;
    number: string;
    amount: number;
    tax: number | null;
    method: string;
    method_label: string;
    reason: string | null;
    at: string;
    register: string;
    by: string;
    items_known: boolean;
  };
  sale: {
    id: number;
    number: string;
    at: string | null;
    total: number;
    total_refunded: number;
  };
  customer: { name: string | null; store_credit: number | null } | null;
  store: {
    name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    timezone: string;
  };
  lines: Array<{ id: number; title: string; detail: string; qty: number; amount: number; tags_verified?: number }>;
};

/**
 * Thermal-paper refund receipt. Same 3 1/8" width, Arial and spacing as
 * ReceiptView so it rasterizes identically for the TM-m30II. The ref'd
 * element for printing is the inner <main>. The merchant copy adds a
 * customer signature line confirming the refund was received.
 */
export function RefundReceiptView({
  data,
  variant = "customer",
}: {
  data: RefundReceiptData;
  variant?: "customer" | "merchant";
}) {
  const { refund, sale, customer, store } = data;
  const tz = store.timezone;
  const cityLine = [store.city, store.state, store.zip].filter(Boolean).join(", ");
  const at = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      timeZone: tz,
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const linesTotal = data.lines.reduce((a, l) => a + l.amount, 0);
  const remaining = Math.max(0, Math.round((sale.total - sale.total_refunded) * 100) / 100);

  const barcode = useMemo(() => {
    const svg = renderBarcodeSvg(sale.number, { heightMm: 10, scale: 2 });
    const b64 =
      typeof window === "undefined"
        ? Buffer.from(svg, "utf-8").toString("base64")
        : window.btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${b64}`;
  }, [sale.number]);

  return (
    <div style={S.page}>
      <main style={S.receipt}>
        <header style={S.center}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="Carbon logo" style={S.logo} />
          <div style={S.address}>
            {store.address_line1 && (
              <>
                {store.address_line1}
                <br />
              </>
            )}
            {store.address_line2 && (
              <>
                {store.address_line2}
                <br />
              </>
            )}
            {cityLine && (
              <>
                {cityLine}
                <br />
              </>
            )}
            {store.phone}
          </div>
          <div style={S.title}>REFUND RECEIPT</div>
          {variant === "merchant" && <div style={S.banner}>** MERCHANT COPY **</div>}
          <div style={S.date}>{at(refund.at)}</div>
        </header>

        <section style={S.info}>
          <KV k="Refund #:" v={refund.number} />
          <KV k="Original sale:" v={sale.number} />
          {sale.at && <KV k="Sale date:" v={at(sale.at).split(",")[0]} />}
          <KV k="Register:" v={refund.register} />
          <KV k="Employee:" v={refund.by} />
          {customer?.name && <KV k="Customer:" v={customer.name} />}
        </section>

        <section>
          <div style={S.itemsHeader}>
            <span>{refund.items_known ? "ITEMS RETURNED" : "ITEMS ON SALE"}</span>
            <span style={S.r}>#</span>
            <span style={S.r}>AMOUNT</span>
          </div>
          {data.lines.map((l) => (
            <div key={l.id} style={S.itemRow}>
              <span>
                <span style={S.itemName}>{l.title}</span>
                {l.detail && <div style={S.itemDetail}>{l.detail}</div>}
                {l.tags_verified ? (
                  <div style={S.itemDetail}>
                    RFID tag{l.tags_verified === 1 ? "" : "s"} verified ✓
                  </div>
                ) : null}
              </span>
              <span style={S.r}>{l.qty}</span>
              <span style={S.r}>{formatMoney(l.amount)}</span>
            </div>
          ))}
          {refund.items_known && Math.abs(linesTotal - refund.amount) > 0.009 && (
            <div style={S.note}>Adjusted to the amount still refundable on the sale.</div>
          )}
        </section>

        <section style={S.totals}>
          {refund.tax != null && refund.tax > 0 && (
            <Row k="Includes tax" v={formatMoney(refund.tax)} muted />
          )}
          <Row k="REFUND TOTAL" v={`-${formatMoney(refund.amount)}`} big />
        </section>

        <section style={S.section}>
          <div style={S.sectionTitle}>REFUNDED TO</div>
          <Row k={refund.method_label} v={formatMoney(refund.amount)} />
          {refund.method === "original_card" && (
            <div style={S.small}>Card refunds take 5–10 business days to appear.</div>
          )}
          {refund.method === "store_credit" && customer?.store_credit != null && (
            <Row k="Store credit balance" v={formatMoney(customer.store_credit)} muted />
          )}
        </section>

        {refund.reason && (
          <section style={S.section}>
            <div style={S.sectionTitle}>REASON</div>
            <div>{refund.reason}</div>
          </section>
        )}

        <section style={S.section}>
          <Row k="Original sale total" v={formatMoney(sale.total)} muted />
          <Row k="Refunded to date" v={`-${formatMoney(sale.total_refunded)}`} muted />
          <Row k="Remaining on sale" v={formatMoney(remaining)} muted />
        </section>

        {variant === "merchant" && (
          <section style={S.signature}>
            <div style={S.sigRule}>
              <span style={S.sigX}>x</span>
            </div>
            <div style={S.sigLabel}>Customer signature</div>
            <div style={S.small}>(acknowledging the refund above was received)</div>
          </section>
        )}

        <div style={S.thanks}>Thank you for shopping with Carbon Jeans Company.</div>

        <div style={S.barcodeWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={barcode} alt={sale.number} style={S.barcode} />
        </div>
      </main>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={S.kv}>
      <span style={{ fontWeight: 700 }}>{k}</span>
      <span>{v}</span>
    </div>
  );
}

function Row({ k, v, muted, big }: { k: string; v: string; muted?: boolean; big?: boolean }) {
  return (
    <div style={{ ...S.row, ...(muted ? S.rowMuted : {}), ...(big ? S.rowBig : {}) }}>
      <span>{k}</span>
      <span style={S.r}>{v}</span>
    </div>
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
    width: "3.125in",
    background: "#fff",
    padding: "6mm 4mm 5mm",
    boxShadow: "0 8px 28px rgba(0,0,0,.16)",
    fontSize: 14,
    lineHeight: 1.25,
    boxSizing: "border-box",
    color: "#000",
  },
  center: { textAlign: "center" },
  logo: { width: "52mm", maxWidth: "100%", height: "auto", display: "block", margin: "0 auto 1.5mm" },
  address: { fontSize: 13, lineHeight: 1.15 },
  title: { marginTop: "4mm", fontSize: 19, fontWeight: 800, letterSpacing: ".25px" },
  banner: { marginTop: "1mm", fontSize: 13, fontWeight: 700 },
  date: { fontSize: 13, marginTop: ".5mm" },
  info: { marginTop: "5mm", fontSize: 14, lineHeight: 1.3 },
  kv: { display: "flex", gap: "1.5mm", alignItems: "baseline" },
  itemsHeader: {
    marginTop: "4mm",
    display: "grid",
    gridTemplateColumns: "1fr 8mm 22mm",
    borderBottom: "1px solid #000",
    fontWeight: 800,
    fontSize: 13,
    paddingBottom: ".7mm",
  },
  itemRow: {
    display: "grid",
    gridTemplateColumns: "1fr 8mm 22mm",
    borderBottom: "1px solid #000",
    padding: ".8mm 0 1mm",
    fontSize: 13,
    lineHeight: 1.2,
  },
  itemName: { fontWeight: 800 },
  itemDetail: { fontSize: 11 },
  note: { fontSize: 11, marginTop: "1mm" },
  totals: { marginTop: "2mm", marginLeft: "22mm" },
  row: { display: "flex", justifyContent: "space-between", fontSize: 13, lineHeight: 1.45 },
  rowMuted: { fontSize: 12 },
  rowBig: { fontSize: 16, fontWeight: 800, borderTop: "1px solid #000", marginTop: "1mm", paddingTop: ".8mm" },
  section: { marginTop: "4mm" },
  sectionTitle: { fontWeight: 800, borderBottom: "1px solid #000", marginBottom: "1mm", fontSize: 13 },
  small: { fontSize: 11, lineHeight: 1.25 },
  r: { textAlign: "right" },
  signature: { marginTop: "9mm" },
  sigRule: { borderBottom: "1px solid #000", height: "6mm", position: "relative" },
  sigX: { position: "absolute", left: 0, bottom: "-1mm", fontWeight: 800, fontSize: 16 },
  sigLabel: { fontSize: 12, marginTop: ".8mm" },
  thanks: { marginTop: "5mm", textAlign: "center", fontSize: 13 },
  barcodeWrap: { marginTop: "3mm", display: "flex", justifyContent: "center" },
  barcode: { width: "56mm", height: "auto" },
};
