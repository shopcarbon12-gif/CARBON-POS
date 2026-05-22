"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ReceiptView } from "@/components/pos/ReceiptView";

type SaleDetail = {
  sale: {
    id: number;
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
    customer_email: string | null;
    customer_first_name?: string | null;
    customer_last_name?: string | null;
    customer_store_credit_balance?: string | number | null;
    receipt_footer: string | null;
    receipt_header?: string | null;
    return_policy: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    phone?: string | null;
  };
  lines: Array<{
    id: number;
    description: string;
    quantity: number;
    line_total: string;
  }>;
  payments: Array<{
    id: number;
    method: "card" | "cash" | "check" | "store_credit";
    amount: string;
    change_given: string | null;
  }>;
  loyalty?: {
    is_member: boolean;
    points: number;
    dollar_value: number;
  };
};

function ReceiptInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const saleId = Number(params.get("sale"));
  const [data, setData] = useState<SaleDetail | null>(null);
  const [printState, setPrintState] = useState<
    "idle" | "printing" | "done" | "error"
  >("idle");
  const [emailValue, setEmailValue] = useState("");
  const [emailState, setEmailState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(saleId)) return;
    fetch(`/api/pos/sales/${saleId}`)
      .then((r) => r.json())
      .then((d: SaleDetail) => {
        setData(d);
        if (d?.sale?.customer_email) setEmailValue(d.sale.customer_email);
      });
  }, [saleId]);

  async function print() {
    setPrintState("printing");
    setErrorMsg(null);

    // 1) Cloud server builds the ESC/POS bytes (it knows the sale data,
    //    formatting rules, sharp-rasterized logo, barcode). It does NOT
    //    open a TCP socket — that's our job from this browser, which is
    //    on the same LAN as the printer.
    const res = await fetch(`/api/pos/sales/${saleId}/escpos`);
    if (!res.ok) {
      setErrorMsg("Couldn't build the receipt.");
      setPrintState("error");
      return;
    }
    const payload = await res.json();
    if (payload.skipped) {
      setErrorMsg(
        "No receipt printer is configured for this location. Set it in Settings → Locations → printer host/port.",
      );
      setPrintState("error");
      return;
    }

    // 2) POST each copy as ePOS-Print XML to the printer over the LAN.
    //    The TM-m30II accepts raw ESC/POS bytes inside a <command> tag
    //    on its built-in /cgi-bin/epos/service.cgi endpoint.
    try {
      for (const copy of payload.copies as Array<{
        variant: string;
        hex: string;
      }>) {
        await sendToEposPrinter(payload.host, copy.hex);
      }
      setPrintState("done");
    } catch (err) {
      console.error("[print] ePOS-Print POST failed", err);
      setErrorMsg(
        "Couldn't reach the printer over the LAN. First-time setup: open " +
          `https://${
            (await safeGetPrinterHost(saleId)) ?? "the printer IP"
          } in a new tab and accept the certificate warning, then try again.`,
      );
      setPrintState("error");
    }
  }

  async function sendEmail() {
    if (!emailValue.trim()) return;
    setEmailState("sending");
    setErrorMsg(null);
    const res = await fetch(`/api/pos/sales/${saleId}/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailValue.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.message ?? "Couldn't send the email.");
      setEmailState("error");
      return;
    }
    setEmailState("done");
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--color-pos-muted)]">Loading receipt…</p>
      </main>
    );
  }
  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto">
      <div
        className="rounded-2xl border border-[var(--color-pos-border)] overflow-y-auto bg-[#e9e9e9]"
        style={{ maxHeight: "60vh" }}
      >
        <ReceiptView
          sale={data.sale}
          lines={data.lines}
          payments={data.payments}
          loyalty={data.loyalty}
          variant="merchant"
        />
        <ReceiptView
          sale={data.sale}
          lines={data.lines}
          payments={data.payments}
          loyalty={data.loyalty}
          variant="customer"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={print}
          disabled={printState === "printing"}
          className="tap-lg rounded-2xl bg-[var(--color-pos-ink)] text-white text-lg font-semibold"
        >
          {printState === "printing"
            ? "Printing…"
            : printState === "done"
              ? "Printed ✓ — Print again"
              : "Print Receipt"}
        </button>
        <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-3 flex flex-col gap-2">
          <input
            type="email"
            value={emailValue}
            onChange={(e) => setEmailValue(e.target.value)}
            placeholder="customer@email.com"
            className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
          />
          <button
            onClick={sendEmail}
            disabled={!emailValue.trim() || emailState === "sending"}
            className="tap rounded-xl bg-white border border-[var(--color-pos-border)] font-semibold"
          >
            {emailState === "sending"
              ? "Sending…"
              : emailState === "done"
                ? "Sent ✓"
                : "Email Receipt"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <p className="mt-4 text-center text-[var(--color-pos-danger)]">
          {errorMsg}
        </p>
      )}

      <button
        onClick={() => router.replace(`/sales/${code}/new`)}
        className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent)] text-white text-xl font-semibold mt-4"
      >
        New Sale
      </button>
    </main>
  );
}

/**
 * POST a hex-encoded ESC/POS payload to a TM-m30II's ePOS-Print HTTPS
 * endpoint. The printer wraps raw bytes inside a `<command>` element
 * and prints them as-is, so we don't have to translate the existing
 * server-built ESC/POS into ePOS XML elements one tag at a time.
 *
 * Uses HTTPS (not HTTP) because the POS app is served from HTTPS and
 * browsers block mixed-content fetches. The TM-m30II ships with a
 * self-signed cert on port 443 — each cashier device must visit
 * `https://<printer-ip>` once and accept the certificate warning to
 * whitelist the printer; after that the fetch below works silently.
 *
 * `mode: 'no-cors'` because EPSON's web service doesn't emit CORS
 * headers. The response is opaque, so we treat any successful network
 * round-trip as "delivered" and rely on the cashier to spot a missing
 * receipt.
 */
async function safeGetPrinterHost(saleId: number): Promise<string | null> {
  try {
    const r = await fetch(`/api/pos/sales/${saleId}/escpos`);
    if (!r.ok) return null;
    const p = await r.json();
    return typeof p?.host === "string" ? p.host : null;
  } catch {
    return null;
  }
}

async function sendToEposPrinter(host: string, hexBytes: string): Promise<void> {
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<s:Body>` +
    `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">` +
    `<command>${hexBytes}</command>` +
    `</epos-print>` +
    `</s:Body>` +
    `</s:Envelope>`;
  const url = `https://${host}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
  await fetch(url, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: xml,
  });
}

export default function ReceiptPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-[var(--color-pos-muted)]">Loading…</p>
        </main>
      }
    >
      <ReceiptInner />
    </Suspense>
  );
}
