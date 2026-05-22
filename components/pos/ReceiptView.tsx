"use client";

import Image from "next/image";
import { formatMoney } from "@/lib/utils";

type SaleHeader = {
  sale_number: string;
  location_name: string;
  register_name: string;
  cashier_email: string;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
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
 * On-screen receipt rendered at thermal-paper proportions (80mm ≈ 320px
 * wide, monospaced font) so the cashier sees roughly what the printer
 * will spit out. Used on /pos/receipt and /admin/sales/[id].
 */
export function ReceiptView({
  sale,
  lines,
  payments,
}: {
  sale: SaleHeader;
  lines: LineRow[];
  payments: PaymentRow[];
}) {
  const cityLine = [sale.city, sale.state, sale.zip].filter(Boolean).join(" ");
  const discount = Number(sale.discount_amount);
  return (
    <div className="flex justify-center">
      <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-5 w-[22rem] font-mono text-[12px] leading-tight text-black shadow-sm">
        <div className="flex flex-col items-center mb-2">
          <Image
            src="/logo.jpg"
            alt=""
            width={120}
            height={120}
            className="mb-2 rounded"
            priority
          />
          <p className="font-bold text-base tracking-wide uppercase text-center">
            {sale.location_name}
          </p>
          {sale.address_line1 && <p>{sale.address_line1}</p>}
          {sale.address_line2 && <p>{sale.address_line2}</p>}
          {cityLine && <p>{cityLine}</p>}
          {sale.phone && <p>{sale.phone}</p>}
          {sale.receipt_header && (
            <p className="text-center mt-1">{sale.receipt_header}</p>
          )}
        </div>

        <Divider />

        <div className="space-y-0.5">
          <Row label="Sale" value={sale.sale_number} />
          <Row label="Reg." value={sale.register_name} />
          <Row
            label="Date"
            value={new Date(sale.completed_at ?? sale.created_at).toLocaleString()}
          />
          <Row label="Csr." value={sale.cashier_email} />
        </div>

        <Divider />

        <ul>
          {lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span className="break-words">
                {l.quantity}x {l.description}
              </span>
              <span className="tabular-nums whitespace-nowrap">
                {formatMoney(l.line_total)}
              </span>
            </li>
          ))}
        </ul>

        <Divider />

        <div className="space-y-0.5">
          <Row label="Subtotal" value={formatMoney(sale.subtotal)} mono />
          {discount > 0 && (
            <Row
              label="Discount"
              value={`-${formatMoney(sale.discount_amount)}`}
              mono
            />
          )}
          <Row label="Tax" value={formatMoney(sale.tax_amount)} mono />
        </div>

        <div className="border-t border-dashed border-black/60 my-1 pt-1 flex justify-between font-bold text-[16px]">
          <span>TOTAL</span>
          <span className="tabular-nums">{formatMoney(sale.total_amount)}</span>
        </div>

        <Divider />

        {payments.length > 1 && (
          <p className="font-bold">Tendered</p>
        )}
        <div className="space-y-0.5">
          {payments.map((p) => (
            <div key={p.id}>
              <Row
                label={humanMethod(p.method)}
                value={formatMoney(p.amount)}
                mono
              />
              {p.method === "cash" && p.change_given ? (
                <Row
                  label="  Change"
                  value={formatMoney(p.change_given)}
                  mono
                  muted
                />
              ) : null}
            </div>
          ))}
        </div>

        <Divider />

        {sale.return_policy && (
          <p className="text-center text-[11px]">{sale.return_policy}</p>
        )}
        <p className="text-center mt-1">
          {sale.receipt_footer ?? "Thank you!"}
        </p>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-dashed border-black/40 my-2" />;
}

function Row({
  label,
  value,
  mono = false,
  muted = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-2 ${muted ? "text-black/60" : ""}`}
    >
      <span>{label}</span>
      <span className={mono ? "tabular-nums" : ""}>{value}</span>
    </div>
  );
}

export function humanMethod(m: string): string {
  return (
    {
      card: "Card",
      cash: "Cash",
      check: "Check",
      store_credit: "Store credit",
      account: "Account",
      gift_card: "Gift card",
    }[m] ?? m
  );
}
