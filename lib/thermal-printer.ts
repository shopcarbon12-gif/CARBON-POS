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

/**
 * Build a node-thermal-printer instance + return null if no printer is
 * configured. Centralises the host/port/connection check so the helpers
 * below all share the same fallback behavior in dev.
 */
async function connectPrinter(): Promise<Printer | null> {
  const host = process.env.THERMAL_PRINTER_HOST?.trim();
  if (!host) return null;
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
  return printer;
}

type CashMovementSlip = {
  type: "drop" | "payout" | "add";
  amount: string;
  reason: string | null;
  done_at: string;
  done_by_name: string;
  location_name: string;
  register_name: string;
};

/**
 * Print a small audit slip for a cash drop / payout / add. Receipt-paper
 * sized — header + four lines + cut. The intent is to leave a paper trail
 * the manager can staple to the till count at end of day.
 */
export async function printCashMovementSlip(
  slip: CashMovementSlip,
): Promise<{ ok: true } | { skipped: true }> {
  const printer = await connectPrinter();
  if (!printer) return { skipped: true };

  const verb =
    slip.type === "add"
      ? "CASH ADDED TO DRAWER"
      : slip.type === "drop"
        ? "CASH DROP"
        : "CASH PAYOUT";

  printer.alignCenter();
  printer.bold(true);
  printer.println(verb);
  printer.bold(false);
  printer.println(slip.location_name);
  printer.println(slip.register_name);
  printer.drawLine();

  printer.alignLeft();
  printer.bold(true);
  printer.tableCustom([
    { text: "Amount", align: "LEFT", width: 0.5 },
    { text: formatMoney(slip.amount), align: "RIGHT", width: 0.5 },
  ]);
  printer.bold(false);
  if (slip.reason) {
    printer.tableCustom([
      { text: "Reason", align: "LEFT", width: 0.3 },
      { text: slip.reason, align: "LEFT", width: 0.7 },
    ]);
  }
  printer.println(`By:    ${slip.done_by_name}`);
  printer.println(`When:  ${new Date(slip.done_at).toLocaleString()}`);
  printer.drawLine();

  printer.alignCenter();
  printer.println("Keep with the till count.");
  printer.cut();

  await printer.execute();
  return { ok: true };
}

type OpenSlip = {
  opening_cash: string;
  opened_at: string;
  opened_by_name: string;
  location_name: string;
  register_name: string;
};

/**
 * Print a small "register opened with $X" audit slip. Same intent as the
 * cash-movement slip — paper trail for the till.
 */
export async function printRegisterOpenSlip(
  slip: OpenSlip,
): Promise<{ ok: true } | { skipped: true }> {
  const printer = await connectPrinter();
  if (!printer) return { skipped: true };

  printer.alignCenter();
  printer.bold(true);
  printer.println("REGISTER OPENED");
  printer.bold(false);
  printer.println(slip.location_name);
  printer.println(slip.register_name);
  printer.drawLine();

  printer.alignLeft();
  printer.bold(true);
  printer.tableCustom([
    { text: "Opening cash", align: "LEFT", width: 0.6 },
    { text: formatMoney(slip.opening_cash), align: "RIGHT", width: 0.4 },
  ]);
  printer.bold(false);
  printer.println(`By:    ${slip.opened_by_name}`);
  printer.println(`When:  ${new Date(slip.opened_at).toLocaleString()}`);
  printer.drawLine();

  printer.alignCenter();
  printer.println("Start of shift.");
  printer.cut();

  await printer.execute();
  return { ok: true };
}

type EodRow = {
  label: string;
  calculated: string;
  counted: string;
  over_short: string;
};

type EodSlip = {
  closed_at: string;
  closed_by_name: string;
  opened_at: string;
  location_name: string;
  register_name: string;
  rows: EodRow[];
  total_calculated: string;
  total_counted: string;
  total_over_short: string;
  note: string | null;
};

/**
 * Print the End-of-Day report on receipt paper at close. Compact layout —
 * three columns (Calc / Counted / +/-) so the cashier can staple it to
 * the deposit slip.
 */
export async function printRegisterCloseEod(
  slip: EodSlip,
): Promise<{ ok: true } | { skipped: true }> {
  const printer = await connectPrinter();
  if (!printer) return { skipped: true };

  printer.alignCenter();
  printer.bold(true);
  printer.println("END OF DAY");
  printer.bold(false);
  printer.println(slip.location_name);
  printer.println(slip.register_name);
  printer.drawLine();

  printer.alignLeft();
  printer.println(
    `Open:  ${new Date(slip.opened_at).toLocaleString()}`,
  );
  printer.println(
    `Close: ${new Date(slip.closed_at).toLocaleString()}`,
  );
  printer.println(`By:    ${slip.closed_by_name}`);
  printer.drawLine();

  printer.tableCustom([
    { text: "Type",  align: "LEFT",  width: 0.34 },
    { text: "Calc",  align: "RIGHT", width: 0.22 },
    { text: "Count", align: "RIGHT", width: 0.22 },
    { text: "+/-",   align: "RIGHT", width: 0.22 },
  ]);
  for (const r of slip.rows) {
    printer.tableCustom([
      { text: r.label,             align: "LEFT",  width: 0.34 },
      { text: formatMoney(r.calculated), align: "RIGHT", width: 0.22 },
      { text: formatMoney(r.counted),    align: "RIGHT", width: 0.22 },
      { text: formatSigned(r.over_short), align: "RIGHT", width: 0.22 },
    ]);
  }
  printer.drawLine();
  printer.bold(true);
  printer.tableCustom([
    { text: "TOTAL",                       align: "LEFT",  width: 0.34 },
    { text: formatMoney(slip.total_calculated), align: "RIGHT", width: 0.22 },
    { text: formatMoney(slip.total_counted),    align: "RIGHT", width: 0.22 },
    { text: formatSigned(slip.total_over_short), align: "RIGHT", width: 0.22 },
  ]);
  printer.bold(false);
  printer.drawLine();

  if (slip.note) {
    printer.alignLeft();
    printer.println("Notes:");
    printer.println(slip.note);
    printer.drawLine();
  }

  printer.alignCenter();
  printer.println("End of shift.");
  printer.cut();

  await printer.execute();
  return { ok: true };
}

function formatSigned(amount: string | number): string {
  const n = Number(amount);
  if (n === 0) return formatMoney(0);
  return n > 0 ? `+${formatMoney(n)}` : `-${formatMoney(Math.abs(n))}`;
}
