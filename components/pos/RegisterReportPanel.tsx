"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RegisterReportView } from "@/components/pos/RegisterReportView";
import { printElement } from "@/lib/epos-print";
import type { RegisterReport } from "@/lib/register-report-types";

type Kind = "open" | "eod";

/**
 * Loads a register session's report, shows the receipt-width preview(s)
 * and prints them on the store's receipt printer via ePOS-Print (same
 * browser → printer path as sale receipts).
 *
 *   autoPrint     — print `kinds[0]` as soon as it renders (used right
 *                   after Open / Close Register).
 *   continueHref  — big "Continue" button target for the cashier flow.
 */
export function RegisterReportPanel({
  sessionId,
  kinds,
  autoPrint = false,
  continueHref,
  continueLabel = "Continue",
}: {
  sessionId: number;
  kinds: Kind[];
  autoPrint?: boolean;
  continueHref?: string;
  continueLabel?: string;
}) {
  const [report, setReport] = useState<RegisterReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, "idle" | "printing" | "done" | "error">>({});
  const [printError, setPrintError] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const autoDone = useRef(false);

  useEffect(() => {
    fetch(`/api/pos/sessions/${sessionId}/report`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as RegisterReport;
      })
      .then(setReport)
      .catch(() => setLoadError("Couldn't load this report."));
  }, [sessionId]);

  const print = useCallback(
    async (kind: Kind) => {
      if (!report) return;
      setPrintError(null);
      if (!report.printer_host) {
        setPrintError(
          "No receipt printer is configured for this location. Set it in Settings → Locations → printer host/port.",
        );
        setState((s) => ({ ...s, [kind]: "error" }));
        return;
      }
      const main = refs.current[kind]?.querySelector("main");
      if (!main) return;
      setState((s) => ({ ...s, [kind]: "printing" }));
      try {
        await printElement(report.printer_host, main as HTMLElement);
        setState((s) => ({ ...s, [kind]: "done" }));
      } catch (err) {
        console.error("[register-report] print failed", err);
        setPrintError(
          `Couldn't reach the printer at ${report.printer_host}. If Chrome asks to "access other ` +
          `devices on your local network", click Allow. Otherwise open ` +
          `https://${report.printer_host}/ in a new tab, accept the certificate warning, ` +
          `then try again.`,
        );
        setState((s) => ({ ...s, [kind]: "error" }));
      }
    },
    [report],
  );

  useEffect(() => {
    if (!autoPrint || !report || autoDone.current) return;
    autoDone.current = true;
    // Let the logo image finish loading before rasterizing.
    const t = setTimeout(() => void print(kinds[0]), 400);
    return () => clearTimeout(t);
  }, [autoPrint, report, kinds, print]);

  if (loadError) {
    return <p className="text-carbon-danger">{loadError}</p>;
  }
  if (!report) {
    return <p className="text-carbon-text-muted">Loading report…</p>;
  }

  const visible = kinds.filter(
    (k) => k === "open" || report.session.status === "closed",
  );

  return (
    <div>
      <div
        className={`grid gap-6 ${visible.length > 1 ? "lg:grid-cols-2" : ""}`}
      >
        {visible.map((k) => (
          <div key={k} className="flex flex-col gap-3">
            <div
              ref={(el) => {
                refs.current[k] = el;
              }}
              className="border border-carbon-border-soft overflow-y-auto bg-[#e9e9e9]"
              style={{ maxHeight: "70vh" }}
            >
              <RegisterReportView report={report} kind={k} />
            </div>
            <button
              type="button"
              onClick={() => void print(k)}
              disabled={state[k] === "printing"}
              className="carbon-btn-secondary tap px-5 font-semibold text-base inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">print</span>
              {state[k] === "printing"
                ? "Printing…"
                : state[k] === "done"
                  ? "Printed ✓ — Print again"
                  : k === "open"
                    ? "Print Open Report"
                    : "Print End of Day Report"}
            </button>
          </div>
        ))}
      </div>

      {printError ? (
        <p className="text-carbon-danger mt-4 text-base">{printError}</p>
      ) : null}

      {continueHref ? (
        <Link
          href={continueHref}
          replace
          className="carbon-btn-primary tap-lg mt-6 w-full flex items-center justify-center text-lg font-semibold"
        >
          {continueLabel}
        </Link>
      ) : null}
    </div>
  );
}
