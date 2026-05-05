import { printer as Printer, types as PrinterTypes } from "node-thermal-printer";
import { formatMoney } from "@/lib/utils";

type SaleRow = {
  id: number;
  sale_number: string;
  total_amount: string;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  completed_at: string | null;
  created_at: string;
  receipt_header: string | null;
  receipt_footer: string | null;
  return_policy: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  location_name: string;
  register_name: string;
  cashier_email: string;
};

type LineRow = {
  description: string;
  quantity: number;
  line_total: string;
};

type PaymentRow = {
  method: "card" | "cash" | "check" | "store_credit";
  amount: string;
  change_given: string | null;
};

/**
 * Print a sale receipt to the configured network ESC/POS printer and kick
 * the cash drawer open. Falls back to { skipped: true } when the printer
 * host isn't configured (development on a laptop with no hardware).
 */
export async function printSaleReceipt({
  sale,
  lines,
  payments,
}: {
  sale: SaleRow;
  lines: LineRow[];
  payments: PaymentRow[];
}): Promise<{ ok: true } | { skipped: true }> {
  const host = process.env.THERMAL_PRINTER_HOST?.trim();
  if (!host) return { skipped: true };
  const port = Number(process.env.THERMAL_PRINTER_PORT ?? 9100);
  const printer = new Printer({
    type: PrinterTypes.EPSON,
    interface: `tcp://${host}:${port}`,
    options: { timeout: 5_000 },
    width: 48,
  });

  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) {
    throw new Error(`Printer at ${host}:${port} is not reachable.`);
  }

  printer.alignCenter();
  printer.bold(true);
  printer.println(sale.location_name);
  printer.bold(false);
  if (sale.address_line1) printer.println(sale.address_line1);
  if (sale.address_line2) printer.println(sale.address_line2);
  const cityLine = [sale.city, sale.state, sale.zip].filter(Boolean).join(" ");
  if (cityLine) printer.println(cityLine);
  if (sale.phone) printer.println(sale.phone);
  if (sale.receipt_header) printer.println(sale.receipt_header);
  printer.drawLine();

  printer.alignLeft();
  printer.println(
    `Sale ${sale.sale_number} · ${sale.register_name}`,
  );
  printer.println(
    `${new Date(sale.completed_at ?? sale.created_at).toLocaleString()}`,
  );
  printer.println(`Cashier ${sale.cashier_email}`);
  printer.drawLine();

  for (const l of lines) {
    const qty = `${l.quantity}× `;
    const right = formatMoney(l.line_total);
    const text = qty + l.description;
    printer.tableCustom([
      { text, align: "LEFT", width: 0.7 },
      { text: right, align: "RIGHT", width: 0.3 },
    ]);
  }
  printer.drawLine();
  printer.tableCustom([
    { text: "Subtotal", align: "LEFT", width: 0.7 },
    { text: formatMoney(sale.subtotal), align: "RIGHT", width: 0.3 },
  ]);
  printer.tableCustom([
    { text: "Discount", align: "LEFT", width: 0.7 },
    { text: `-${formatMoney(sale.discount_amount)}`, align: "RIGHT", width: 0.3 },
  ]);
  printer.tableCustom([
    { text: "Tax", align: "LEFT", width: 0.7 },
    { text: formatMoney(sale.tax_amount), align: "RIGHT", width: 0.3 },
  ]);
  printer.bold(true);
  printer.tableCustom([
    { text: "TOTAL", align: "LEFT", width: 0.5 },
    { text: formatMoney(sale.total_amount), align: "RIGHT", width: 0.5 },
  ]);
  printer.bold(false);
  printer.drawLine();

  for (const p of payments) {
    const label = humanMethod(p.method);
    printer.tableCustom([
      { text: label, align: "LEFT", width: 0.7 },
      { text: formatMoney(p.amount), align: "RIGHT", width: 0.3 },
    ]);
    if (p.method === "cash" && p.change_given) {
      printer.tableCustom([
        { text: "  Change", align: "LEFT", width: 0.7 },
        { text: formatMoney(p.change_given), align: "RIGHT", width: 0.3 },
      ]);
    }
  }

  printer.drawLine();
  printer.alignCenter();
  if (sale.return_policy) {
    printer.println(sale.return_policy);
  }
  if (sale.receipt_footer) {
    printer.println(sale.receipt_footer);
  } else {
    printer.println("Thank you!");
  }
  printer.cut();

  if (process.env.CASH_DRAWER_KICK !== "0") {
    printer.openCashDrawer();
  }

  await printer.execute();
  return { ok: true };
}

function humanMethod(m: PaymentRow["method"]): string {
  switch (m) {
    case "card":
      return "Card";
    case "cash":
      return "Cash";
    case "check":
      return "Check";
    case "store_credit":
      return "Store credit";
  }
}
