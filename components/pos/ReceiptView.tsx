"use client";

import Image from "next/image";
import { useMemo } from "react";
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

/**
 * Receipt view tuned to the carbon_receipt_barcode_more_short_height.html
 * reference: centered logo + address, "Sales Receipt" title, info block,
 * items table, right-indented totals, PAYMENTS / STORE ACCOUNT sections,
 * return policy, EAN-13 barcode of the ticket number. Rendered at 80mm
 * (~22rem) so the on-screen preview matches paper.
 */
type LoyaltyFooter = {
  is_member: boolean;
  points: number;
  dollar_value: number;
};

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

  const barcodeSvg = useMemo(
    () => renderBarcodeSvg(sale.sale_number, { heightMm: 12, scale: 2 }),
    [sale.sale_number],
  );

  return (
    <div className="flex justify-center">
      <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-5 w-[22rem] font-sans text-[12px] leading-tight text-black shadow-sm">
        <div className="flex flex-col items-center mb-2">
          <Image
            src="/logo.jpg"
            alt=""
            width={170}
            height={170}
            className="mb-1.5"
            priority
          />
          <div className="text-[11px] leading-tight text-center">
            {sale.address_line1 && <div>{sale.address_line1}</div>}
            {sale.address_line2 && <div>{sale.address_line2}</div>}
            {cityLine && <div>{cityLine}</div>}
            <div>United States</div>
            {sale.phone && <div>{sale.phone}</div>}
          </div>
          <p className="font-extrabold text-[16px] tracking-wide mt-3">
            Sales Receipt
          </p>
          <p className="text-[11px]">
            {new Date(sale.completed_at ?? sale.created_at).toLocaleString()}
          </p>
        </div>

        <section className="mt-3 space-y-0.5">
          <Row label="Ticket:" value={sale.sale_number} />
          <Row label="Register:" value={sale.register_name} />
          <Row label="Employee:" value={sale.cashier_email} />
          {customerName && <Row label="Customer:" value={customerName} />}
        </section>

        <section className="mt-3">
          <div className="grid grid-cols-[1fr_2.5rem_4.5rem] font-extrabold text-[12px] border-b border-black pb-0.5">
            <span>Items</span>
            <span className="text-right">#</span>
            <span className="text-right">Price</span>
          </div>
          {lines.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[1fr_2.5rem_4.5rem] border-b border-black py-1 text-[11px]"
            >
              <span className="font-extrabold leading-tight">
                {l.description}
              </span>
              <span className="text-right tabular-nums">{l.quantity}</span>
              <span className="text-right tabular-nums">
                {formatMoney(l.line_total)}
              </span>
            </div>
          ))}
        </section>

        <section className="mt-2 ml-[7rem] text-[12px] leading-snug">
          <Row label="Subtotal" value={formatMoney(sale.subtotal)} mono />
          {discount > 0 && (
            <Row
              label="Discount"
              value={`-${formatMoney(sale.discount_amount)}`}
              mono
            />
          )}
          <Row
            label={
              taxRate && taxBase != null
                ? `Tax (${formatMoney(taxBase)} @ ${(taxRate * 100).toFixed(2)}%)`
                : "Tax"
            }
            value={formatMoney(sale.tax_amount)}
            mono
          />
          <Row
            label="Total"
            value={formatMoney(sale.total_amount)}
            mono
            bold
          />
        </section>

        <Section title="PAYMENTS">
          <div className="ml-[7rem]">
            {payments.map((p) => (
              <div key={p.id}>
                <Row
                  label={humanMethod(p.method)}
                  value={formatMoney(p.amount)}
                  mono
                />
                {p.method === "cash" && p.change_given ? (
                  <Row
                    label="Change"
                    value={formatMoney(p.change_given)}
                    mono
                    muted
                  />
                ) : null}
              </div>
            ))}
          </div>
        </Section>

        {storeCredit != null && (
          <Section title="STORE ACCOUNT">
            <div className="ml-[7rem]">
              <Row label="On Deposit:" value={formatMoney(storeCredit)} mono />
            </div>
          </Section>
        )}

        {loyalty && loyalty.points > 0 && (
          <Section
            title={loyalty.is_member ? "CARBON REWARDS" : "JOIN CARBON REWARDS"}
          >
            {loyalty.is_member ? (
              <div className="ml-[7rem]">
                <Row
                  label="Points earned"
                  value={String(loyalty.points)}
                  mono
                />
                <Row
                  label="Approx. cashback"
                  value={formatMoney(loyalty.dollar_value)}
                  mono
                />
              </div>
            ) : (
              <p className="text-[11px] leading-snug">
                You would have earned <b>{loyalty.points} pts</b> (~
                {formatMoney(loyalty.dollar_value)}). Ask the cashier to enroll
                on your next visit and start saving!
              </p>
            )}
          </Section>
        )}

        <section className="mt-4 text-center">
          <p className="font-extrabold text-[14px] tracking-wide">
            {sale.return_policy ?? "NO REFUNDS — EXCHANGE ONLY"}
          </p>
        </section>

        <p className="mt-3 text-center text-[12px]">
          {sale.receipt_footer ??
            (customerName ? `Thank You ${customerName}!` : "Thank You!")}
        </p>

        <div
          className="mt-3 flex justify-center [&_svg]:w-[80%] [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: barcodeSvg }}
        />
        <p className="text-center text-[10px] mt-0.5 tracking-wider">
          {ean13Display(sale.sale_number)}
        </p>
      </div>
    </div>
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
    <section className="mt-3">
      <p className="font-extrabold text-[12px] tracking-wider border-b border-black pb-0.5">
        {title}
      </p>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  mono = false,
  muted = false,
  bold = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-2 ${muted ? "text-black/60" : ""} ${
        bold ? "font-extrabold text-[13px]" : ""
      }`}
    >
      <span>{label}</span>
      <span className={mono ? "tabular-nums" : ""}>{value}</span>
    </div>
  );
}

export function humanMethod(m: string): string {
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
