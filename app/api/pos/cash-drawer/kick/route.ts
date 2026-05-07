import { NextResponse } from "next/server";
import { printer as Printer, types as PrinterTypes } from "node-thermal-printer";
import { currentCashier } from "@/lib/session";

/**
 * POST /api/pos/cash-drawer/kick
 * Kicks the cash drawer open via the configured ESC/POS printer. Returns
 * { skipped: true } when no printer is configured so the UI can stay
 * silent in dev.
 */
export async function POST() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const host = process.env.THERMAL_PRINTER_HOST?.trim();
  if (!host) return NextResponse.json({ skipped: true });
  const port = Number(process.env.THERMAL_PRINTER_PORT ?? 9100);
  const printer = new Printer({
    type: PrinterTypes.EPSON,
    interface: `tcp://${host}:${port}`,
    options: { timeout: 5_000 },
    width: 48,
  });
  try {
    const isConnected = await printer.isPrinterConnected();
    if (!isConnected) {
      return NextResponse.json(
        {
          error: "printer_unreachable",
          message: "The receipt printer isn't responding.",
        },
        { status: 502 },
      );
    }
    printer.openCashDrawer();
    await printer.execute();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cash-drawer/kick]", err);
    return NextResponse.json(
      {
        error: "printer_failed",
        message: "Couldn't kick the cash drawer.",
      },
      { status: 502 },
    );
  }
}
