"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  RefundReceiptView,
  type RefundReceiptData,
} from "@/components/pos/RefundReceiptView";
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

/**
 * Refund receipt screen (?refund=<pos_refunds.id>). Shown right after a
 * refund and reachable later from Reports → Refunds & Voids. Prints a
 * merchant copy (with customer signature line) and a customer copy
 * through the store print agent; a cash refund also pops the drawer.
 */
function RefundReceiptInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const refundId = Number(params.get("refund"));
  const back = params.get("back");
  const [data, setData] = useState<RefundReceiptData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "printing" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const merchantRef = useRef<HTMLDivElement>(null);
  const customerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!Number.isFinite(refundId)) return;
    fetch(`/api/pos/refunds/${refundId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as RefundReceiptData;
      })
      .then(setData)
      .catch(() => setLoadError("Couldn't load this refund."));
  }, [refundId]);

  // Print automatically when it opens (once per refund on this device).
  useEffect(() => {
    if (!data) return;
    if (!claimAutoPrint(`refund:${refundId}`)) return;
    const t = setTimeout(() => void print(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, refundId]);

  async function print() {
    if (!data) return;
    setState("printing");
    setErrorMsg(null);
    // Store (signature) copy only for card refunds; cash / store credit
    // print just the customer copy.
    const needsMerchant = data.refund.method === "original_card";
    const merchantMain = needsMerchant ? merchantRef.current?.querySelector("main") : null;
    const customerMain = customerRef.current?.querySelector("main");
    if ((needsMerchant && !merchantMain) || !customerMain) {
      setErrorMsg("Receipt isn't rendered yet — wait a moment and retry.");
      setState("error");
      return;
    }
    try {
      const job = async (el: Element, kick: boolean) =>
        bytesToHex(
          concatBytes(
            escPosInit(),
            // Drawer opens before the paper prints.
            ...(kick ? [escPosKickDrawer()] : []),
            canvasToEscPosRaster(await rasterizeElement(el as HTMLElement)),
            escPosFeed(3),
            escPosCut(),
          ),
        );
      const cash = data.refund.method === "cash";
      await deliverPrint([
        ...(merchantMain ? [await job(merchantMain, cash)] : []),
        await job(customerMain, cash && !merchantMain),
      ]);
      setState("done");
    } catch (err) {
      console.error("[refund-receipt] print failed", err);
      setErrorMsg(err instanceof PrintError ? err.message : "Couldn't print the refund receipt.");
      setState("error");
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--color-pos-danger)]">{loadError}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--color-pos-muted)]">Loading refund receipt…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto">
      {data.refund.method === "cash" && (
        <div className="mb-4 border-4 border-amber-500 bg-amber-50 p-4 text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-amber-800">Give the customer cash</p>
          <p className="total-display text-5xl text-amber-800">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(data.refund.amount)}
          </p>
        </div>
      )}
      <div className="text-center mb-4">
        <p className="text-[var(--color-pos-muted)]">Refunded to {data.refund.method_label}</p>
        <p className="total-display text-4xl mt-1">
          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
            data.refund.amount,
          )}
        </p>
      </div>
      <div
        className="rounded-2xl border border-[var(--color-pos-border)] overflow-y-auto bg-[#e9e9e9]"
        style={{ maxHeight: "60vh" }}
      >
        {data.refund.method === "original_card" && (
          <div ref={merchantRef}>
            <RefundReceiptView data={data} variant="merchant" />
          </div>
        )}
        <div ref={customerRef}>
          <RefundReceiptView data={data} variant="customer" />
        </div>
      </div>

      <button
        onClick={() => void print()}
        disabled={state === "printing"}
        className="tap-lg w-full rounded-2xl bg-[var(--color-pos-ink)] text-white text-lg font-semibold mt-4 disabled:opacity-50"
      >
        {state === "printing"
          ? "Printing…"
          : state === "done"
            ? "Printed ✓ — Print again"
            : "Print Refund Receipt"}
      </button>

      {errorMsg && (
        <p className="mt-4 text-center text-[var(--color-pos-danger)]">{errorMsg}</p>
      )}

      <button
        onClick={() => router.replace(back && back.startsWith("/") ? back : `/sales/${code}`)}
        className="tap-lg w-full rounded-2xl bg-[var(--color-pos-accent)] text-white text-xl font-semibold mt-4"
      >
        Done
      </button>
    </main>
  );
}

export default function RefundReceiptPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-[var(--color-pos-muted)]">Loading…</p>
        </main>
      }
    >
      <RefundReceiptInner />
    </Suspense>
  );
}
