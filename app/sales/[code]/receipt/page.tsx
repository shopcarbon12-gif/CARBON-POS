"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ReceiptView } from "@/components/pos/ReceiptView";
import {
  bytesToHex,
  canvasToEscPosRaster,
  concatBytes,
  escPosCut,
  escPosFeed,
  escPosInit,
  escPosKickDrawer,
  rasterizeElement,
} from "@/lib/receipt-raster";
import { deliverPrint, PrintError } from "@/lib/epos-print";
import { claimAutoPrint } from "@/lib/print-once";

type SaleDetail = {
  sale: {
    id: number;
    sale_number: string;
    location_name: string;
    register_name: string;
    cashier_email: string;
    cashier_first_name?: string | null;
    cashier_last_name?: string | null;
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
    cash_given?: string | null;
  }>;
  exchange_payouts?: Array<{ method: string; amount: number }>;
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
  const merchantRef = useRef<HTMLDivElement>(null);
  const customerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!Number.isFinite(saleId)) return;
    fetch(`/api/pos/sales/${saleId}`)
      .then((r) => r.json())
      .then((d: SaleDetail) => {
        setData(d);
        if (d?.sale?.customer_email) setEmailValue(d.sale.customer_email);
      });
  }, [saleId]);

  const printRef = useRef<() => Promise<void>>(async () => {});
  // Print automatically when the receipt opens (once per sale on this
  // device — reprints via the button).
  useEffect(() => {
    if (!data || !Number.isFinite(saleId)) return;
    if (!claimAutoPrint(`sale:${saleId}`)) return;
    // Not cancelled on re-render (a refresh would otherwise eat the
    // one-and-only auto print); reads the latest print() via a ref.
    setTimeout(() => void printRef.current(), 700); // let the logo/barcode load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, saleId]);

  printRef.current = () => print();
  async function print() {
    setPrintState("printing");
    setErrorMsg(null);

    // Rasterize each on-screen ReceiptView to the printer's native
    //    dot width. The merchant + customer ReceiptView nodes are
    //    rendered (visible, scrollable) above; html-to-image walks the
    //    DOM and produces a pixel-perfect canvas of what you see.
    // The ref wraps ReceiptView, which renders <div page><main receipt>.
    // Only the inner <main> (the white 80mm card) is the design — the
    // outer page wrapper is gray screen padding we don't want to print.
    // The merchant (signature) copy is only for card payments; cash and
    // other sales print just the customer copy.
    const needsMerchant = !!data?.payments.some((p) => p.method === "card");
    const merchantMain = needsMerchant ? merchantRef.current?.querySelector("main") : null;
    const customerMain = customerRef.current?.querySelector("main");
    if ((needsMerchant && !merchantMain) || !customerMain) {
      setErrorMsg("Receipt isn't rendered yet — wait a moment and retry.");
      setPrintState("error");
      return;
    }

    try {
      const merchantCanvas = merchantMain
        ? await rasterizeElement(merchantMain as HTMLElement)
        : null;
      const customerCanvas = await rasterizeElement(
        customerMain as HTMLElement,
      );

      // The cash drawer opens FIRST — before any paper prints — so the
      // kick goes at the very start of the first job.
      const merchantJob = merchantCanvas
        ? concatBytes(
            escPosInit(),
            escPosKickDrawer(),
            canvasToEscPosRaster(merchantCanvas),
            escPosFeed(3),
            escPosCut(),
          )
        : null;
      const customerJob = concatBytes(
        escPosInit(),
        ...(merchantJob ? [] : [escPosKickDrawer()]),
        canvasToEscPosRaster(customerCanvas),
        escPosFeed(3),
        escPosCut(),
      );

      // Store print agent when online, else browser → printer.
      await deliverPrint([
        ...(merchantJob ? [bytesToHex(merchantJob)] : []),
        bytesToHex(customerJob),
      ]);
      setPrintState("done");
    } catch (err) {
      console.error("[print] rasterize / print failed", err);
      setErrorMsg(
        err instanceof PrintError ? err.message : "Couldn't print the receipt.",
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
  // Cash to hand over: change on a cash sale, or an exchange difference
  // paid back in cash.
  const cashPay = data.payments.filter((p) => p.method === "cash");
  const changeDue = cashPay.reduce((s, p) => s + Number(p.change_given ?? 0), 0);
  const cashGiven = cashPay.reduce((s, p) => s + Number(p.cash_given ?? 0), 0);
  const cashBack = (data.exchange_payouts ?? []).filter((p) => p.method === "cash").reduce((s, p) => s + p.amount, 0);
  const cardBack = (data.exchange_payouts ?? []).filter((p) => p.method === "original_card").reduce((s, p) => s + p.amount, 0);
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <main className="min-h-screen p-4 sm:p-6 flex justify-center">
      {/* Actions on the left, receipt preview on the right — centered. */}
      <div className="w-full max-w-5xl flex flex-col lg:flex-row gap-6 justify-center items-start">
        <div className="w-full lg:w-96 shrink-0 lg:sticky lg:top-6">
      {changeDue > 0.004 && (
        <div className="mb-4 border-4 border-emerald-600 bg-emerald-50 p-4 text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-emerald-800">Give change</p>
          <p className="total-display text-5xl text-emerald-800">{money(changeDue)}</p>
          {cashGiven > 0 && (
            <p className="text-sm text-emerald-900 mt-1">
              Cash given {money(cashGiven)} · Total {money(Number(data.sale.total_amount))}
            </p>
          )}
        </div>
      )}
      {cashBack > 0.004 && (
        <div className="mb-4 border-4 border-amber-500 bg-amber-50 p-4 text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-amber-800">Give the customer cash</p>
          <p className="total-display text-5xl text-amber-800">{money(cashBack)}</p>
          <p className="text-sm text-amber-900 mt-1">Exchange difference (approved override)</p>
        </div>
      )}
      {cardBack > 0.004 && (
        <div className="mb-4 border-2 border-carbon-border bg-white p-3 text-center text-sm">
          {money(cardBack)} exchange difference refunded to the customer&apos;s card.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3">
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
          <a
            href={`/api/pos/sales/${saleId}/pdf`}
            target="_blank"
            rel="noopener"
            className="text-sm text-center underline text-[var(--color-pos-muted)]"
          >
            View PDF receipt
          </a>
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
        </div>
        <div className="w-full lg:w-auto">
      <div
        className="rounded-2xl border border-[var(--color-pos-border)] overflow-y-auto bg-[#e9e9e9]"
        style={{ maxHeight: "calc(100vh - 3rem)" }}
      >
        {data.payments.some((p) => p.method === "card") && (
          <div ref={merchantRef}>
            <ReceiptView
              sale={data.sale}
              lines={data.lines}
              payments={data.payments}
              loyalty={data.loyalty}
              variant="merchant"
            />
          </div>
        )}
        <div ref={customerRef}>
          <ReceiptView
            sale={data.sale}
            lines={data.lines}
            payments={data.payments}
            loyalty={data.loyalty}
            variant="customer"
          />
        </div>
      </div>

        </div>
      </div>
    </main>
  );
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
