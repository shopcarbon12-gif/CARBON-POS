import path from "node:path";
import { printer as Printer, types as PrinterTypes } from "node-thermal-printer";
import sharp from "sharp";
import { formatMoney } from "@/lib/utils";
import { ean13Display } from "@/lib/barcode";
import { renderBarcodePng } from "@/lib/barcode-node";

/**
 * 80mm thermal printers are typically 384 dots wide at 8 dots/mm. We aim
 * for ~360 to leave a small margin so the logo never bleeds into the
 * edge. The buffer is computed once and cached for the life of the
 * process — receipts are printed often and reading + rasterizing the
 * JPG on every sale would visibly slow the cashier down.
 */
const LOGO_TARGET_WIDTH = 360;
let cachedLogo: Promise<Buffer | null> | null = null;

function loadLogoBuffer(): Promise<Buffer | null> {
  if (cachedLogo) return cachedLogo;
  cachedLogo = (async () => {
    try {
      const filePath = path.join(process.cwd(), "public", "logo.jpg");
      return await sharp(filePath)
        .resize({ width: LOGO_TARGET_WIDTH, withoutEnlargement: true })
        .grayscale()
        .png()
        .toBuffer();
    } catch (err) {
      console.warn("[thermal] logo unavailable, skipping:", err);
      return null;
    }
  })();
  return cachedLogo;
}

async function printLogo(printer: Printer): Promise<void> {
  const buf = await loadLogoBuffer();
  if (!buf) return;
  printer.alignCenter();
  await printer.printImageBuffer(buf);
  printer.newLine();
}

type SaleRow = {
  id: number;
  sale_number: string;
  total_amount: string;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  tax_rate?: string | number | null;
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
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_store_credit_balance?: string | number | null;
  /** Per-location printer config from pos_locations. Falls back to the
   *  THERMAL_PRINTER_HOST / _PORT env vars when null (test/dev). */
  printer_host?: string | null;
  printer_port?: number | string | null;
};

/**
 * Resolve the host/port for a print job. Per-location DB config wins;
 * the env vars are kept as a single-store dev fallback.
 */
function resolvePrinterTarget(override?: {
  host?: string | null;
  port?: number | string | null;
}): { host: string; port: number } | null {
  const host = (override?.host ?? process.env.THERMAL_PRINTER_HOST ?? "").trim();
  if (!host) return null;
  const portRaw = override?.port ?? process.env.THERMAL_PRINTER_PORT ?? 9100;
  const port = Number(portRaw) || 9100;
  return { host, port };
}

type LineRow = {
  description: string;
  quantity: number;
  line_total: string;
};

type PaymentRow = {
  method: "card" | "cash" | "check" | "store_credit" | "account" | "gift_card";
  amount: string;
  change_given: string | null;
};

type LoyaltyFooter = {
  is_member: boolean;
  points: number;
  dollar_value: number;
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
  loyalty,
}: {
  sale: SaleRow;
  lines: LineRow[];
  payments: PaymentRow[];
  loyalty?: LoyaltyFooter;
}): Promise<{ ok: true } | { skipped: true }> {
  const target = resolvePrinterTarget({
    host: sale.printer_host,
    port: sale.printer_port,
  });
  if (!target) return { skipped: true };
  const printer = new Printer({
    type: PrinterTypes.EPSON,
    interface: `tcp://${target.host}:${target.port}`,
    options: { timeout: 5_000 },
    width: 48,
  });

  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) {
    throw new Error(
      `Printer at ${target.host}:${target.port} is not reachable.`,
    );
  }

  // Logo at the top — falls through silently if the asset is missing.
  await printLogo(printer);

  printer.alignCenter();
  if (sale.address_line1) printer.println(sale.address_line1);
  if (sale.address_line2) printer.println(sale.address_line2);
  const cityLine = [sale.city, sale.state, sale.zip].filter(Boolean).join(", ");
  if (cityLine) printer.println(cityLine);
  printer.println("United States");
  if (sale.phone) printer.println(sale.phone);
  if (sale.receipt_header) printer.println(sale.receipt_header);

  printer.newLine();
  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.println("Sales Receipt");
  printer.bold(false);
  printer.setTextNormal();
  printer.println(
    new Date(sale.completed_at ?? sale.created_at).toLocaleString(),
  );
  printer.newLine();

  printer.alignLeft();
  const customerName = [sale.customer_first_name, sale.customer_last_name]
    .filter(Boolean)
    .join(" ");
  printer.println(`Ticket:    ${sale.sale_number}`);
  printer.println(`Register:  ${sale.register_name}`);
  printer.println(`Employee:  ${sale.cashier_email}`);
  if (customerName) printer.println(`Customer:  ${customerName}`);

  printer.newLine();
  // Items header — bold underline row, then per-item rows split into
  // bolded name plus right-aligned qty/price columns.
  printer.bold(true);
  printer.tableCustom([
    { text: "ITEMS", align: "LEFT", width: 0.62 },
    { text: "#", align: "RIGHT", width: 0.13 },
    { text: "PRICE", align: "RIGHT", width: 0.25 },
  ]);
  printer.bold(false);
  printer.drawLine();

  for (const l of lines) {
    const nameBudget = 28;
    const name = l.description;
    if (name.length <= nameBudget) {
      printer.bold(true);
      printer.tableCustom([
        { text: name, align: "LEFT", width: 0.62 },
        { text: String(l.quantity), align: "RIGHT", width: 0.13 },
        { text: formatMoney(l.line_total), align: "RIGHT", width: 0.25 },
      ]);
      printer.bold(false);
    } else {
      // Bold the first line (truncated to the name budget) with the
      // qty + price on the right. Spill the rest as plain follow-up
      // lines so long product names don't get silently chopped.
      printer.bold(true);
      printer.tableCustom([
        { text: name.slice(0, nameBudget), align: "LEFT", width: 0.62 },
        { text: String(l.quantity), align: "RIGHT", width: 0.13 },
        { text: formatMoney(l.line_total), align: "RIGHT", width: 0.25 },
      ]);
      printer.bold(false);
      const rest = name.slice(nameBudget);
      for (let i = 0; i < rest.length; i += nameBudget) {
        printer.println(rest.slice(i, i + nameBudget));
      }
    }
  }
  printer.drawLine();

  // Totals are right-aligned with a wide left gutter so the structure
  // matches the on-screen receipt.
  const totalsRow = (label: string, value: string, bold = false) => {
    if (bold) printer.bold(true);
    printer.tableCustom([
      { text: label, align: "LEFT", width: 0.6 },
      { text: value, align: "RIGHT", width: 0.4 },
    ]);
    if (bold) printer.bold(false);
  };
  totalsRow("Subtotal", formatMoney(sale.subtotal));
  if (Number(sale.discount_amount) > 0) {
    totalsRow("Discount", `-${formatMoney(sale.discount_amount)}`);
  }
  const taxRate = sale.tax_rate != null ? Number(sale.tax_rate) : null;
  const taxAmount = Number(sale.tax_amount);
  const taxBase =
    taxRate && taxRate > 0
      ? Math.round((taxAmount / taxRate) * 100) / 100
      : null;
  const taxLabel =
    taxRate && taxBase != null
      ? `Tax (${formatMoney(taxBase)} @ ${(taxRate * 100).toFixed(2)}%)`
      : "Tax";
  totalsRow(taxLabel, formatMoney(sale.tax_amount));
  printer.setTextDoubleHeight();
  totalsRow("TOTAL", formatMoney(sale.total_amount), true);
  printer.setTextNormal();

  // PAYMENTS section.
  printer.newLine();
  printer.bold(true);
  printer.println("PAYMENTS");
  printer.bold(false);
  printer.drawLine();
  if (payments.length > 1) {
    printer.bold(true);
    printer.println("Tendered");
    printer.bold(false);
  }
  for (const p of payments) {
    totalsRow(humanMethod(p.method), formatMoney(p.amount));
    if (p.method === "cash" && p.change_given) {
      totalsRow("  Change", formatMoney(p.change_given));
    }
  }

  // STORE ACCOUNT section (only when a customer with a balance is on the sale).
  if (
    sale.customer_store_credit_balance != null &&
    Number(sale.customer_store_credit_balance) !== 0
  ) {
    printer.newLine();
    printer.bold(true);
    printer.println("STORE ACCOUNT");
    printer.bold(false);
    printer.drawLine();
    totalsRow(
      "On Deposit:",
      formatMoney(sale.customer_store_credit_balance),
    );
  }

  // Loyalty footer — points earned (members) or join offer (walk-ins).
  if (loyalty && loyalty.points > 0) {
    printer.newLine();
    printer.alignLeft();
    if (loyalty.is_member) {
      printer.bold(true);
      printer.println("CARBON REWARDS");
      printer.bold(false);
      printer.drawLine();
      totalsRow("Points earned", `${loyalty.points}`);
      totalsRow(
        "Approx. cashback",
        formatMoney(loyalty.dollar_value),
      );
    } else {
      printer.bold(true);
      printer.println("JOIN CARBON REWARDS");
      printer.bold(false);
      printer.drawLine();
      printer.alignLeft();
      printer.println(
        `You would have earned ${loyalty.points} pts (about ${formatMoney(
          loyalty.dollar_value,
        )}).`,
      );
      printer.println("Ask the cashier to enroll on your next visit.");
    }
  }

  // Policy + thanks.
  printer.newLine();
  printer.alignCenter();
  printer.bold(true);
  printer.println(sale.return_policy ?? "NO REFUNDS - EXCHANGE ONLY");
  printer.bold(false);
  if (sale.receipt_footer) {
    printer.println(sale.receipt_footer);
  } else if (customerName) {
    printer.println(`Thank You ${customerName}!`);
  } else {
    printer.println("Thank You!");
  }

  // Ticket barcode — EAN-13 when seq fits, Code128 otherwise.
  printer.newLine();
  try {
    const barcodePng = await renderBarcodePng(sale.sale_number, {
      heightMm: 12,
      scale: 2,
    });
    await printer.printImageBuffer(barcodePng);
    printer.println(ean13Display(sale.sale_number));
  } catch (err) {
    console.warn("[thermal] barcode render failed:", err);
    printer.println(ean13Display(sale.sale_number));
  }

  printer.newLine();
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
      return "Credit Card";
    case "cash":
      return "Cash";
    case "check":
      return "Check";
    case "store_credit":
      return "Store credit";
    default:
      // 'account' / 'gift_card' / future methods — fall back to a
      // tidied capitalisation rather than printing the raw enum.
      return String(m)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/**
 * Build a node-thermal-printer instance + return null if no printer is
 * configured. Centralises the host/port/connection check so the helpers
 * below all share the same fallback behavior in dev.
 */
async function connectPrinter(override?: {
  host?: string | null;
  port?: number | string | null;
}): Promise<Printer | null> {
  const target = resolvePrinterTarget(override);
  if (!target) return null;
  const printer = new Printer({
    type: PrinterTypes.EPSON,
    interface: `tcp://${target.host}:${target.port}`,
    options: { timeout: 5_000 },
    width: 48,
  });
  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) {
    throw new Error(
      `Printer at ${target.host}:${target.port} is not reachable.`,
    );
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
  printer_host?: string | null;
  printer_port?: number | string | null;
};

/**
 * Print a small audit slip for a cash drop / payout / add. Receipt-paper
 * sized — header + four lines + cut. The intent is to leave a paper trail
 * the manager can staple to the till count at end of day.
 */
export async function printCashMovementSlip(
  slip: CashMovementSlip,
): Promise<{ ok: true } | { skipped: true }> {
  const printer = await connectPrinter({
    host: slip.printer_host,
    port: slip.printer_port,
  });
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
  printer_host?: string | null;
  printer_port?: number | string | null;
};

/**
 * Print a small "register opened with $X" audit slip. Same intent as the
 * cash-movement slip — paper trail for the till.
 */
export async function printRegisterOpenSlip(
  slip: OpenSlip,
): Promise<{ ok: true } | { skipped: true }> {
  const printer = await connectPrinter({
    host: slip.printer_host,
    port: slip.printer_port,
  });
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
  printer_host?: string | null;
  printer_port?: number | string | null;
};

/**
 * Print the End-of-Day report on receipt paper at close. Compact layout —
 * three columns (Calc / Counted / +/-) so the cashier can staple it to
 * the deposit slip.
 */
export async function printRegisterCloseEod(
  slip: EodSlip,
): Promise<{ ok: true } | { skipped: true }> {
  const printer = await connectPrinter({
    host: slip.printer_host,
    port: slip.printer_port,
  });
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
