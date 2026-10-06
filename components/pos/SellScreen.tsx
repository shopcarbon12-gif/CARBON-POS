"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ItemSearch, type SearchResultItem } from "./ItemSearch";
import { CartPanel } from "./CartPanel";
import { TotalPanel, type PickedCustomer } from "./TotalPanel";
import { RedeemPointsModal } from "./RedeemPointsModal";
import { RFIDScanModal, type RfidResolvedItem } from "./RFIDScanModal";
import { CashKeypad } from "./CashKeypad";
import { OverrideModal, type OverrideKind } from "./OverrideModal";
import { captureLines } from "@/lib/capture-payload";
import { enqueueOfflineSale, serverReachable } from "@/lib/offline-queue";
import type { ReturnableLine, ReturnableSale } from "@/lib/returns-types";
import { calculateTotals } from "@/lib/tax";
import { markdownFraction, needsManagerApproval } from "@/lib/discount-policy";
import { capitalizeName } from "@/lib/utils";
import type { CartLine, AttributionEmployee } from "@/types/pos";

/**
 * Sell screen. Renders inside the back-office AdminShell — the layout
 * matches the carbon_sales_interface_active_cart_light reference:
 *
 *   [breadcrumb]
 *   [register header card]
 *   ┌──────────────── left ────────────────┐ ┌── right (420px) ──┐
 *   │ search + RFID                         │ │ Customer           │
 *   │ cart (item rows w/ qty stepper)       │ │ Subtotal/Disc/Tax  │
 *   │ Misc · Hold · Clear                   │ │ Total              │
 *   └───────────────────────────────────────┘ │ Apply discount     │
 *                                             │ Charge Card        │
 *                                             │ Take Cash          │
 *                                             │ Other              │
 *                                             └────────────────────┘
 */
export function SellScreen({
  taxRate,
  code,
  cashierEmployeeId,
}: {
  taxRate: number;
  /** Active location code (e.g. "003") — used to build navigation URLs. */
  code: string;
  /** pos_employees.id of the signed-in cashier. Used as the default
   *  attributed employee for every new cart line and the cart-header
   *  attribution dropdown. */
  cashierEmployeeId: number;
  /** Kept for backward-compat; the AdminShell now handles sign-out. */
  onSignOut?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [lines, setLines] = useState<CartLine[]>([]);
  // Employee attribution: who gets credit for the sale. Defaults to the
  // signed-in cashier; the cart-header dropdown bulk-rewrites every line
  // when changed; each row has its own dropdown for individual overrides.
  const [saleAttributedEmployeeId, setSaleAttributedEmployeeId] =
    useState<number>(cashierEmployeeId);
  const [employees, setEmployees] = useState<AttributionEmployee[]>([]);
  const [showRfid, setShowRfid] = useState(false);
  const [showMisc, setShowMisc] = useState(false);
  // Returns / exchanges on this screen: scan a receipt, take pieces back
  // as negative lines (RFID pieces verified by scanning their tag), keep
  // scanning new items; the cart nets the difference.
  const [returnSale, setReturnSale] = useState<ReturnableSale | null>(null);
  const [returnPanelOpen, setReturnPanelOpen] = useState(false);
  const returnLines = lines.filter((l) => l.line_type === "return");
  const pendingTags = returnLines.filter((l) => l.return_ref?.needs_tag && !l.return_ref?.epc).length;
  const returnMode: "none" | "exchange" | "refund" =
    returnLines.length === 0
      ? "none"
      : lines.some((l) => l.line_type !== "return")
        ? "exchange"
        : "refund";

  // Arrived from the Exchange / Refund buttons: prompt for the receipt.
  useEffect(() => {
    const mode = searchParams.get("returns");
    if (mode) {
      setOfflineNotice(
        `${mode === "refund" ? "Refund" : "Exchange"}: scan the receipt barcode (or type the receipt number) in the search box and press Enter.`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadReceipt(receipt: string): Promise<boolean> {
    const r = await fetch(`/api/pos/returns/lookup?number=${encodeURIComponent(receipt)}`).catch(() => null);
    if (!r?.ok) return false;
    const { sale } = (await r.json()) as { sale: ReturnableSale };
    if (returnLines.length > 0 && returnLines[0].return_ref?.sale_id !== sale.id) {
      setOfflineNotice(
        `This cart already has returns from #${returnLines[0].return_ref?.sale_number}. Finish or remove those before returning items from another receipt.`,
      );
      return true;
    }
    setReturnSale(sale);
    setReturnPanelOpen(true);
    if (!customer && sale.customer) {
      setCustomer({ id: sale.customer.id, name: sale.customer.name ?? "", email: sale.customer.email ?? null, phone: null } as PickedCustomer);
    }
    return true;
  }

  // A held cart with returns (resumed) brings its receipt back.
  useEffect(() => {
    const ref = lines.find((l) => l.line_type === "return")?.return_ref;
    if (ref && (!returnSale || returnSale.id !== ref.sale_id)) {
      fetch(`/api/pos/returns/lookup?sale_id=${ref.sale_id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.sale && setReturnSale(d.sale))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length]);

  /** Pieces of a sale line already in the cart as returns. */
  function inCartReturns(lineId: number) {
    return lines.filter((l) => l.line_type === "return" && l.return_ref?.line_id === lineId);
  }

  function returnLineFor(sale: ReturnableSale, line: ReturnableLine, epc: string | null): CartLine {
    return {
      cart_id: cryptoId(),
      sku_id: null,
      epc: null,
      description: `Return · ${line.description}`,
      quantity: 1,
      unit_price: -line.unit_value,
      discount_amount: 0,
      tax_rate: 0,
      line_type: "return",
      attributed_employee_id: saleAttributedEmployeeId,
      return_ref: {
        sale_id: sale.id,
        sale_number: sale.sale_number,
        line_id: line.id,
        epc,
        needs_tag: line.epcs.length > 0,
      },
    };
  }

  /** "−1" from the return panel. RFID pieces wait for their tag scan. */
  function addReturnPiece(line: ReturnableLine) {
    if (!returnSale) return;
    if (line.available_qty - inCartReturns(line.id).length <= 0) return;
    setLines((prev) => [...prev, returnLineFor(returnSale, line, null)]);
  }

  /** Tags scanned that were sold on the receipt: verify waiting return
   *  lines, or add new verified return lines. */
  function applyReturnTags(epcs: string[]) {
    if (!returnSale) return;
    setLines((prev) => {
      const next = [...prev];
      const used = new Set(next.map((l) => l.return_ref?.epc).filter(Boolean) as string[]);
      for (const raw of epcs) {
        const epc = raw.toUpperCase();
        if (used.has(epc)) continue;
        const line = returnSale.lines.find(
          (l) => l.epcs.includes(epc) && !l.returned_epcs.includes(epc),
        );
        if (!line) continue;
        used.add(epc);
        const waiting = next.findIndex(
          (l) => l.line_type === "return" && l.return_ref?.line_id === line.id && !l.return_ref?.epc,
        );
        if (waiting >= 0) {
          next[waiting] = { ...next[waiting], return_ref: { ...next[waiting].return_ref!, epc } };
        } else {
          const inCart = next.filter((l) => l.line_type === "return" && l.return_ref?.line_id === line.id).length;
          if (inCart < line.available_qty) next.push(returnLineFor(returnSale, line, epc));
        }
      }
      return next;
    });
  }

  function cancelReturn() {
    setLines((prev) => prev.filter((l) => l.line_type !== "return"));
    setReturnSale(null);
    setReturnPanelOpen(false);
  }

  /** Tags on the receipt still returnable and not yet scanned into the cart. */
  const returnableEpcs = returnSale
    ? returnSale.lines
        .flatMap((l) => l.epcs.filter((e) => !l.returned_epcs.includes(e)))
        .filter((e) => !returnLines.some((l) => l.return_ref?.epc === e))
    : [];
  // Offline cash sales: register id cached for when the server is down.
  const [offline, setOffline] = useState(false);
  const [offlineCash, setOfflineCash] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [registerId, setRegisterId] = useState<number | null>(null);
  useEffect(() => {
    const key = `pos:register:${code}`;
    try {
      const cached = Number(localStorage.getItem(key));
      if (cached) setRegisterId(cached);
    } catch {
      /* ignore */
    }
    fetch("/api/pos/sessions?current=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const id = d?.session?.register_id;
        if (id) {
          setRegisterId(id);
          try {
            localStorage.setItem(key, String(id));
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => undefined);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    setOffline(navigator.onLine === false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [code]);
  // Admin override in progress (RFID sale / RFID return).
  const [overrideReq, setOverrideReq] = useState<{
    kind: OverrideKind;
    refId: string;
    title: string;
    detail: string;
    onApproved: (token: string, approver: string) => void;
  } | null>(null);
  // Hold / park sale.
  const [showHold, setShowHold] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [discountFor, setDiscountFor] = useState<string | "sale" | null>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Preview of the sale # the next completed sale will receive.
  // Rendered in the CartPanel header so the cashier can see + cite
  // the sale # to the customer before they pay.
  const [saleNumberPreview, setSaleNumberPreview] = useState<string | null>(
    null,
  );
  // When the cashier searches and picks an item whose catalog row is
  // RFID-mode (is_manual_only=false), we hold the item here and surface
  // a confirm dialog instead of adding straight to the cart. The two
  // exits are "Process Manual" (just adds with the mismatch red-radio
  // badge) and "Scan RFID" (opens the scan modal so the customer's
  // physical tag drives the add).
  const [rfidConfirmItem, setRfidConfirmItem] = useState<SearchResultItem | null>(null);

  // Loyalty phone-prompt on the customer's card reader. The flow:
  //   sale opens (no customer) → reader shows phone prompt
  //   customer enters → POS looks up by phone
  //     match found → attach customer
  //     no match → pendingPhone is set; cashier sees blinking phone box
  //       w/ "+" and a drawer for first/last name. Drawer can send the
  //       name prompt to the reader for the customer to fill on pin pad.
  //       Clicking "+" creates the customer + enrolls in loyalty.
  type PromptStatus = "idle" | "collecting" | "looking-up" | "done";
  const [phonePromptStatus, setPhonePromptStatus] =
    useState<PromptStatus>("idle");
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [pendingFirstName, setPendingFirstName] = useState("");
  const [pendingLastName, setPendingLastName] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingCreateError, setPendingCreateError] = useState<string | null>(null);
  const [nameSendingToReader, setNameSendingToReader] = useState(false);
  const promptedForCartRef = useRef(false);

  // RFID reader state model — two independent signals from WMS:
  //   live_scan_active     — INTENT: is the agent told to spawn the
  //                           reader binary? (the POS-set toggle)
  //   reader_status_online — TRUTH:  is the chip actually alive on the
  //                           network? (the CDM watchdog's view)
  //
  // Combined UI states:
  //   "off"          live_scan_active=false              (gray)
  //   "on"           active=true, online=true            (green)
  //   "recovering"   active=true, online=false           (amber pulse)
  //                  → CDM watchdog is actively fixing the chip; POS
  //                    doesn't need to act, just shows the state.
  //   "starting"/"stopping"  in-flight POST transitions  (amber pulse)
  //   "no_reader"    register isn't linked to a CDM agent (gray)
  //   "unreachable"  WMS state poll failing              (red)
  type ReaderState =
    | "off"
    | "on"
    | "recovering"
    | "starting"
    | "stopping"
    | "no_reader"
    | "unreachable";
  const [readerState, setReaderState] = useState<ReaderState>("off");
  const lastActivityRef = useRef<number>(Date.now());
  const fastPollUntilRef = useRef<number>(0);

  // Map the POS state-endpoint response → ReaderState. The endpoint
  // reads the per-row truth on the is_pos_dedicated reader directly.
  // Only two signals drive the badge color:
  //   scan_paused  — per-reader Hardware Config pause flag (cashier or
  //                  warehouse said "stop"). When true → off (gray).
  //   status_online — CDM watchdog. The binary heartbeats every few s;
  //                   true means the reader is actually scanning.
  // agent_active (cdm_agents.live_scan_active) is intentionally NOT a
  // gate here. It's just the supervisor's spawn flag — once the binary
  // is running, it keeps running until either (a) the supervisor sees
  // the flag flip false and kills it, or (b) the reader's scan_paused
  // is set. The flag can be FALSE while the binary is still live and
  // heartbeating (lag between flag-flip and supervisor reaping). Gating
  // the UI on it produced a gray dot during normal scanning. Trust the
  // CDM heartbeat instead.
  const mapState = (r: {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    running?: boolean;
    armed?: boolean;
    scan_paused?: boolean;
    status_online?: boolean;
    agent_active?: boolean;
    recovery_state?: string | null;
    error?: string;
  }): ReaderState => {
    if (r.skipped && r.reason === "no_agent") return "no_reader";
    if (r.error) return "unreachable";
    // The agent's explicit recovery signal wins — it's actively self-healing
    // the reader (only ever set while armed). Amber "Reader recovering…".
    if (
      r.recovery_state === "recovering" ||
      r.recovery_state === "hard_resetting"
    )
      return "recovering";
    if (typeof r.scan_paused === "boolean" && r.scan_paused) return "off";
    // Authoritative on/off: the reader RUNS during store hours or while a
    // cashier is present (armed); otherwise it's intentionally OFF. (status_
    // online is just "producing reads lately" and flips on quiet periods, so
    // it's no longer the on/off source.)
    if (typeof r.running === "boolean") return r.running ? "on" : "off";
    // Legacy fallback (old server without `running`): keep prior behavior.
    if (r.status_online === true) return "on";
    return "off";
  };

  const fetchState = async (): Promise<ReaderState> => {
    try {
      const res = await fetch("/api/pos/hardware/reader/state");
      if (!res.ok) return "unreachable";
      const r = await res.json().catch(() => ({}));
      return mapState(r);
    } catch {
      return "unreachable";
    }
  };

  const startReader = async () => {
    setReaderState("starting");
    // Kick off a fast-poll window so the badge transitions from
    // "starting" → "recovering"/"on" within seconds instead of waiting
    // for the next 20s reconcile.
    fastPollUntilRef.current = Date.now() + 30_000;
    try {
      const res = await fetch("/api/pos/hardware/reader/start", {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (d.skipped && d.reason === "no_agent") {
        setReaderState("no_reader");
      }
      // Don't assume "on" here — the chip may take a few seconds to
      // come online. Let the fast-poll pick up the truth.
    } catch {
      setReaderState("unreachable");
    }
  };
  const stopReader = async () => {
    setReaderState("stopping");
    fastPollUntilRef.current = Date.now() + 10_000;
    try {
      const res = await fetch("/api/pos/hardware/reader/stop", {
        method: "POST",
        keepalive: true,
      });
      const d = await res.json().catch(() => ({}));
      if (d.skipped && d.reason === "no_agent") setReaderState("no_reader");
      else setReaderState("off");
    } catch {
      setReaderState("off"); // best-effort; assume off
    }
  };
  const markActivity = () => {
    lastActivityRef.current = Date.now();
    if (readerState === "off") {
      // Treat cashier activity as a wake signal too (e.g., typing in search
      // after an idle stop). "Scan RFID" click still re-starts explicitly.
      void startReader();
    }
  };

  // Fetch the predicted next sale # on mount + whenever the cart
  // empties (post-sale or post-clear) so the header always reflects
  // the upcoming ticket the cashier is building.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await fetch("/api/pos/sessions?current=1").then((r) =>
          r.json(),
        );
        const registerId: number | null = sess?.session?.register_id ?? null;
        if (!registerId) return;
        const r = await fetch(
          `/api/pos/sales/next-number?register_id=${registerId}`,
        );
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled && typeof d.display === "string") {
          setSaleNumberPreview(d.display);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Refresh when the cart resets to empty (post-sale) — that's when
    // pos_locations.next_sale_seq has incremented.
  }, [lines.length === 0]);

  // Load active employees once on mount for the attribution dropdowns.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/pos/employees/active");
        if (!r.ok) return;
        const d = (await r.json()) as { employees?: AttributionEmployee[] };
        if (!cancelled && Array.isArray(d.employees)) {
          setEmployees(d.employees);
        }
      } catch {
        /* best-effort — dropdown will just be empty until next mount */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-start on mount, auto-stop on unmount. The unmount path covers
  // sale completion (capture redirects to /receipt), tab close, and
  // navigation to other tabs.
  useEffect(() => {
    void startReader();
    // Heartbeat refreshes monitor_armed_at so the agent keeps the reader
    // armed (self-healing) while a cashier is ACTIVELY here. Gated on the same
    // 10-min idle window as the idle-stop watchdog: once the cashier has been
    // idle 10 min, we stop heartbeating, so monitor_armed_at goes stale (~30 s)
    // and the reader disarms — a forgotten/parked tab can't keep it armed
    // forever (esp. important outside store hours).
    const heartbeat = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 10 * 60 * 1000) return;
      void fetch("/api/pos/hardware/reader/keepalive", {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => { /* best-effort */ });
    }, 15_000);
    // Splash strategy per operator directive: DEFAULT splash visible
    // when the sale page first loads (no mount-preload of NEW — would
    // briefly leak "thanks for joining" onto an idle reader before the
    // customer has done anything). Splash only flips to NEW once the
    // phone prompt POSTs, i.e. once the customer is at the reader
    // typing their number — the reader is showing collect_inputs UI
    // at that point so the customer can't see the splash mid-typing.
    //
    // Mount-time defensive revert: if a previous new-customer flow
    // stranded NEW on the account-wide config (deploy mid-dwell, tab
    // close before the client-side 7.5 s fallback ran, or another
    // register's flow leaked here), force DEFAULT now so the reader's
    // next idle transition shows the Carbon splash — not the stuck
    // "Thank you for Joining" JPG.
    void fetch("/api/pos/hardware/reader/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "revert" }),
    }).catch(() => {});
    return () => {
      clearInterval(heartbeat);
      // Two best-effort, fire-and-forget calls on unmount:
      //  1. Cancel any in-flight Stripe action on the reader so the
      //     pinpad returns to the Carbon splash instead of staying
      //     stuck on the last screen.
      //  2. Stop the WMS live-scan so the reader binary winds down
      //     and the chip cools.
      // `keepalive: true` lets the browser flush these requests even as
      // the page is unloading (sendBeacon only supports POST so we use
      // fetch for both).
      const cancelStripe = fetch("/api/pos/loyalty/reader-prompt", {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
      const stopScan = fetch("/api/pos/hardware/reader/stop", {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
      // Best-effort splash revert so the next sale starts on DEFAULT
      // even if a previous new-customer flow's server timer never got
      // to fire (deploy restart, etc.).
      const splashRevert = fetch("/api/pos/hardware/reader/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "revert" }),
        keepalive: true,
      }).catch(() => {});
      void Promise.allSettled([cancelStripe, stopScan, splashRevert]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 10-minute idle watchdog. Resets on any cart change, search input,
  // discount edit, or Scan RFID click (see callers of `markActivity`).
  // Scan RFID re-wakes the reader on click so the cashier doesn't have
  // to think about it.
  useEffect(() => {
    const id = setInterval(() => {
      if (readerState !== "on") return;
      if (Date.now() - lastActivityRef.current > 10 * 60 * 1000) {
        void stopReader();
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [readerState]);

  // Cart mutations are the primary "cashier is doing things" signal —
  // bumps the activity ref so the idle-stop timer doesn't fire mid-sale.
  // Track total quantity (not just row count) so RFID adds that *stack*
  // onto an existing row — same lines.length but higher quantity —
  // still register as activity. Without this, scanning a 6th tag onto
  // an existing row didn't reset the 10-min idle watchdog and the dot
  // would go gray mid-scan.
  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);
  useEffect(() => {
    if (!hydrated) return;
    lastActivityRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalQty]);

  // Background reconcile. Polls /reader/state on an adaptive cadence:
  // every 3 s within 30 s of a manual start/stop (so the badge catches
  // up to the CDM watchdog quickly), every 20 s otherwise. Also auto-
  // retries Start if the badge has been "unreachable" for over 30 s
  // (network blip recovered, or the agent restarted) — matches the
  // "indicator wired to the watchdog, fix immediately on red" policy.
  useEffect(() => {
    let unreachableSince = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      const next = await fetchState();
      if (cancelled) return;
      if (next === "unreachable") {
        if (unreachableSince === 0) unreachableSince = Date.now();
        setReaderState("unreachable");
        // After 30 s of red, kick Start once — covers "agent rebooted"
        // and "network blip recovered" without operator action.
        if (Date.now() - unreachableSince > 30_000) {
          unreachableSince = 0;
          void startReader();
        }
      } else {
        unreachableSince = 0;
        setReaderState(next);
      }
      // Adaptive cadence — every 2 s while the state isn't a steady
      // "on", every 10 s otherwise. The Scan RFID button has a live
      // dot; the cashier sees the watchdog's fix within ~2 s.
      const stable = next === "on";
      const fastWindow = Date.now() < fastPollUntilRef.current;
      timer = setTimeout(tick, stable && !fastWindow ? 10_000 : 2_000);
    };
    // Kick the first tick fast so the badge updates within a second of
    // mount, regardless of the 20-s slow interval.
    timer = setTimeout(tick, 800);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const cartKey = `pos:cart:${code}`;

  // Hydrate cart + customer from localStorage; if the URL carries
  // ?customer_id&customer_name (return trip from /customers/{code}/new),
  // honor those over whatever was persisted.
  useEffect(() => {
    let restoredLines: CartLine[] = [];
    let restoredCustomer: PickedCustomer | null = null;
    try {
      const raw = window.localStorage.getItem(cartKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          lines?: CartLine[];
          customer?: PickedCustomer | null;
        };
        if (Array.isArray(parsed.lines)) restoredLines = parsed.lines;
        if (parsed.customer) restoredCustomer = parsed.customer;
      }
    } catch {
      /* corrupt LS — start fresh */
    }
    const urlId = searchParams.get("customer_id");
    const urlName = searchParams.get("customer_name");
    const urlEmail = searchParams.get("customer_email");
    const urlPhone = searchParams.get("customer_phone");
    if (urlId && urlName) {
      restoredCustomer = {
        id: Number(urlId),
        name: urlName,
        email: urlEmail || null,
        phone: urlPhone || null,
      };
      // Strip the params from the URL so a refresh doesn't re-attach.
      const next = new URLSearchParams(searchParams.toString());
      next.delete("customer_id");
      next.delete("customer_name");
      next.delete("customer_email");
      next.delete("customer_phone");
      const qs = next.toString();
      router.replace(`/sales/${code}/new${qs ? `?${qs}` : ""}`);
    }
    if (restoredLines.length) {
      // Lines persisted before the employee-attribution feature won't have
      // `attributed_employee_id` — backfill them to the signed-in cashier so
      // the dropdowns render and the capture call doesn't reject the row.
      setLines(
        restoredLines.map((l) =>
          l.attributed_employee_id == null
            ? { ...l, attributed_employee_id: cashierEmployeeId }
            : l,
        ),
      );
    }
    if (restoredCustomer) setCustomer(restoredCustomer);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist whenever cart or customer changes.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        cartKey,
        JSON.stringify({ lines, customer }),
      );
    } catch {
      /* ignore quota / private mode */
    }
  }, [lines, customer, hydrated, cartKey]);

  const totals = useMemo(
    () => calculateTotals(lines, taxRate),
    [lines, taxRate],
  );

  // Live-mirror the cart to the customer's card reader display. Debounced so
  // we don't hammer Stripe while the cashier scans rapidly. Clears the
  // display when the cart goes empty so the splash returns. Suppressed
  // while the loyalty phone prompt is active so the two flows don't fight
  // for the reader.
  const promptIsActive =
    phonePromptStatus === "collecting" ||
    phonePromptStatus === "looking-up" ||
    pendingPhone !== null ||
    nameSendingToReader;
  useEffect(() => {
    if (!hydrated) return;
    if (promptIsActive) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      if (lines.length === 0) {
        fetch("/api/pos/readers/display", {
          method: "DELETE",
          signal: ctrl.signal,
        }).catch(() => {});
        return;
      }
      const line_items = lines.map((l) => ({
        description: l.description.slice(0, 100),
        quantity: l.quantity,
        unit_amount_cents: Math.round(l.unit_price * 100),
      }));
      fetch("/api/pos/readers/display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          currency: "usd",
          line_items,
          total_cents: Math.round(totals.total * 100),
          tax_cents: Math.round(totals.tax * 100),
        }),
      }).catch(() => {});
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [lines, totals.total, totals.tax, hydrated, promptIsActive]);

  // Reset prompt state on the TRANSITION from non-empty to empty cart
  // (sale finished, or cashier cleared). Comparing against a ref avoids
  // a feedback loop where the trigger effect would re-fire and the
  // reset would un-fire it on every render.
  const prevLinesLengthRef = useRef(0);
  useEffect(() => {
    const wasNonEmpty = prevLinesLengthRef.current > 0;
    const isEmpty = lines.length === 0;
    prevLinesLengthRef.current = lines.length;
    if (wasNonEmpty && isEmpty) {
      promptedForCartRef.current = false;
      setPhonePromptStatus("idle");
      setPendingPhone(null);
      setPendingFirstName("");
      setPendingLastName("");
      setPendingEmail(""); setPendingCreateError(null);
      setNameSendingToReader(false);
    }
  }, [lines.length]);

  // Auto-trigger the reader phone-prompt as soon as the sell screen opens
  // (after hydration), if no customer is attached. Re-fires after each
  // sale because the cart-empty effect resets promptedForCartRef.
  useEffect(() => {
    if (!hydrated) return;
    if (customer) return;
    if (promptedForCartRef.current) return;
    if (phonePromptStatus !== "idle") return;
    promptedForCartRef.current = true;
    setPhonePromptStatus("collecting");
    fetch("/api/pos/loyalty/reader-prompt", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setPhonePromptStatus("idle");
      })
      .catch(() => setPhonePromptStatus("idle"));
    // Pre-load the new-customer splash NOW so Stripe has the 5–30 s
    // the customer spends typing to propagate the config change to the
    // reader. By the time collect_inputs ends, the splash is already
    // active on the reader; we then either keep it (new customer) or
    // revert it (existing / cancelled) — both happen on the result
    // handler below.
    fetch("/api/pos/hardware/reader/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "preload" }),
    }).catch(() => {});
  }, [hydrated, customer, phonePromptStatus]);

  // Poll the reader's collect_inputs status while collecting the phone.
  // IMPORTANT: keep phonePromptStatus === 'collecting' until the lookup
  // result has been fully processed. Flipping it to 'looking-up' before
  // setCustomer/setPendingPhone causes this effect's deps to change, the
  // cleanup runs, stopped=true, and the result-handling branch ends up
  // returning before any state update lands — looks like "nothing
  // happened in POS" from the cashier's POV.
  const handlingResultRef = useRef(false);
  useEffect(() => {
    if (phonePromptStatus !== "collecting") return;
    let stopped = false;
    const tick = async () => {
      if (stopped || handlingResultRef.current) return;
      try {
        const r = await fetch(
          "/api/pos/loyalty/reader-prompt/status",
        ).then((r) => r.json());
        if (stopped) return;
        if (r.status === "succeeded" && r.phone) {
          handlingResultRef.current = true;
          const lookup = await fetch("/api/pos/loyalty/lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: r.phone }),
          })
            .then((r) => r.json())
            .catch(() => null as null | {
              found?: boolean;
              customer?: { id: number; first_name: string; last_name: string | null; email: string | null; phone: string | null; phone_2: string | null };
              phone?: string;
            });
          if (!lookup) {
            // Lookup failed — keep the prompt going so cashier or
            // background reconcile can retry.
            handlingResultRef.current = false;
            return;
          }
          if (lookup.found && lookup.customer) {
            const c = lookup.customer;
            const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
            setCustomer({
              id: c.id,
              name,
              email: c.email ?? null,
              phone: c.phone ?? c.phone_2 ?? null,
            });
            setPhonePromptStatus("done");
            // Existing customer — revert the preloaded new-customer
            // splash so the reader doesn't briefly show "thanks for
            // joining" when it transitions back to idle.
            fetch("/api/pos/hardware/reader/welcome", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: "revert" }),
            }).catch(() => {});
          } else {
            // No match — surface the pending phone for cashier
            // confirmation. The new-customer splash was already
            // preloaded when the phone prompt started; here we just
            // schedule the auto-revert after dwell_ms. Stripe has had
            // 5–30 s of customer-typing time to propagate the swap.
            setPendingPhone(lookup.phone ?? r.phone);
            setPendingFirstName("");
            setPendingLastName("");
            setPhonePromptStatus("idle");
            fetch("/api/pos/hardware/reader/welcome", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: "new_customer", dwell_ms: 7000 }),
            }).catch(() => {});
            // Belt-and-suspenders client-side fallback revert. The
            // server-side setTimeout that the new_customer call queues
            // is lost if the Next.js process restarts (deploy, crash)
            // during the 7-second window — the welcome JPG then sticks
            // permanently because nothing flips the config back. This
            // client timer fires a fresh `revert` from the browser at
            // T+7s, so even on a hot deploy the splash always returns
            // to DEFAULT. Redundant + idempotent: if the server timer
            // already ran, this is a no-op (setSplashTo just sets the
            // value, which is already DEFAULT).
            window.setTimeout(() => {
              fetch("/api/pos/hardware/reader/welcome", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "revert" }),
              }).catch(() => {});
            }, 7500);
          }
          handlingResultRef.current = false;
        } else if (
          r.status === "canceled" ||
          r.status === "failed" ||
          r.status === "idle"
        ) {
          setPhonePromptStatus("idle");
          // Revert preloaded splash only on EXPLICIT canceled/failed —
          // `idle` can also mean "POST /reader-prompt hasn't landed yet"
          // (race between us starting the polling and Stripe registering
          // the action). Reverting on that early-idle would undo the
          // preload before the customer's even seen the prompt.
          if (r.status === "canceled" || r.status === "failed") {
            fetch("/api/pos/hardware/reader/welcome", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: "revert" }),
            }).catch(() => {});
          }
        }
      } catch {
        /* network blip — keep polling */
      }
    };
    const id = setInterval(tick, 1500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [phonePromptStatus]);


  // Poll the reader's name-prompt action while the cashier has it
  // open. On success the polling handler also fires the auto-create —
  // cashier doesn't have to click "+" after a customer finishes on
  // the pin pad.
  useEffect(() => {
    if (!nameSendingToReader) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await fetch(
          "/api/pos/loyalty/reader-name-prompt/status",
        ).then((r) => r.json());
        if (stopped) return;
        if (r.status === "succeeded") {
          // Title-case names regardless of how the customer typed
          // them; lowercase the email (case-insensitive).
          const first = capitalizeName((r.first_name ?? "").trim());
          const last = capitalizeName((r.last_name ?? "").trim());
          const email = ((r.email ?? "") as string).trim().toLowerCase();
          if (first) setPendingFirstName(first);
          if (last) setPendingLastName(last);
          if (email) setPendingEmail(email);
          setNameSendingToReader(false);
          // Auto-create: same path as a manual "+" click but with the
          // values just collected on the reader.
          if (first && last) {
            void runCreateCustomer({ first, last, email: email || null });
          }
        } else if (
          r.status === "canceled" ||
          r.status === "failed" ||
          r.status === "idle"
        ) {
          setNameSendingToReader(false);
        }
      } catch {
        /* keep polling */
      }
    };
    const id = setInterval(tick, 1500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameSendingToReader]);

  // Cashier-side skip: cancels the reader action and stops the prompt.
  const cancelPhonePrompt = () => {
    setPhonePromptStatus("idle");
    fetch("/api/pos/loyalty/reader-prompt", { method: "DELETE" }).catch(
      () => {},
    );
    // Revert preloaded splash so the reader returns to the default
    // Carbon splash instead of staying on "thanks for joining".
    fetch("/api/pos/hardware/reader/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "revert" }),
    }).catch(() => {});
  };

  // If the cashier picks a customer manually while the reader is still
  // collecting the phone, cancel the reader prompt.
  useEffect(() => {
    if (customer && phonePromptStatus === "collecting") {
      cancelPhonePrompt();
      setPhonePromptStatus("done");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  // ── Pending-phone flow handlers ────────────────────────────────────
  const cancelPendingPhone = () => {
    setPendingPhone(null);
    setPendingFirstName("");
    setPendingLastName("");
    setPendingEmail(""); setPendingCreateError(null);
    setNameSendingToReader(false);
    fetch("/api/pos/loyalty/reader-prompt", { method: "DELETE" }).catch(
      () => {},
    );
    // Revert "thanks for joining" splash early — the cashier closed
    // the pending-phone box, so we no longer want the new-customer
    // splash sitting on the reader for the rest of its scheduled dwell.
    fetch("/api/pos/hardware/reader/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "revert" }),
    }).catch(() => {});
  };

  const sendNameToReader = async () => {
    setNameSendingToReader(true);
    try {
      const res = await fetch("/api/pos/loyalty/reader-name-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.error) setNameSendingToReader(false);
    } catch {
      setNameSendingToReader(false);
    }
  };

  // Single create-customer path used by both the manual "+" click
  // (uses current pending* state) and the reader-completion auto path
  // (uses values just collected from the pin pad).
  const runCreateCustomer = async (override?: {
    first?: string;
    last?: string;
    email?: string | null;
  }) => {
    if (!pendingPhone) return;
    const first = (override?.first ?? pendingFirstName).trim();
    const last = (override?.last ?? pendingLastName).trim();
    const emailRaw = (override?.email ?? pendingEmail) ?? "";
    const email = typeof emailRaw === "string" ? emailRaw.trim() : "";
    if (!first) {
      setPendingCreateError("First name is required.");
      return;
    }
    if (!last) {
      setPendingCreateError("Last name is required.");
      return;
    }
    setPendingCreateError(null);
    try {
      const res = await fetch("/api/pos/loyalty/create-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: pendingPhone,
          first_name: first,
          last_name: last,
          email: email.length > 0 ? email : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.customer) {
        setPendingCreateError(
          data.message ??
            "Couldn't create the customer — please try again or attach an existing one.",
        );
        return;
      }
      const c = data.customer;
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
      setCustomer({
        id: c.id,
        name,
        email: c.email ?? null,
        phone: c.phone ?? c.phone_2 ?? null,
      });
      // Cancel any in-flight reader action so cart-mirror can take over.
      fetch("/api/pos/loyalty/reader-prompt", { method: "DELETE" }).catch(
        () => {},
      );
      setPendingPhone(null);
      setPendingFirstName("");
      setPendingLastName("");
      setPendingEmail("");
      setPendingCreateError(null);
      setNameSendingToReader(false);
      setPhonePromptStatus("done");
    } catch (err) {
      setPendingCreateError(
        `Network error — couldn't reach the server. ${
          err instanceof Error ? err.message : ""
        }`,
      );
    }
  };

  const confirmCreateCustomer = () => void runCreateCustomer();

  // Re-send the phone prompt to the reader. Used by the small phone
  // icon next to the "+" in the customer search row when the cashier
  // has previously skipped or wants to re-ask.
  const resendPhonePrompt = () => {
    setPhonePromptStatus("collecting");
    fetch("/api/pos/loyalty/reader-prompt", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setPhonePromptStatus("idle");
      })
      .catch(() => setPhonePromptStatus("idle"));
  };

  // ── Loyalty integration ─────────────────────────────────────────────
  // When a customer is attached, fetch their balance from
  // /api/pos/loyalty/balance (a thin proxy on POS that calls
  // rewards.shopcarbon.com server-side with the API key). Cleared on
  // detach. RedeemPointsModal is gated on having a balance + subtotal,
  // and on the program being live (Rewards admin can pause it — earning
  // still runs, only redemption is switched off at the till).
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [redeemSettings, setRedeemSettings] = useState<{
    live: boolean;
    redeemPointsPerDollar: number;
    redeemIncrement: number;
    minRedeemPoints: number;
    maxPctOfOrder: number;
    maxDollarsPerOrder: number;
  }>({ live: true, redeemPointsPerDollar: 10, redeemIncrement: 100, minRedeemPoints: 100, maxPctOfOrder: 50, maxDollarsPerOrder: 30 });
  const [showRedeem, setShowRedeem] = useState(false);

  useEffect(() => {
    // Clear first so a failed lookup never leaves the previous customer's
    // balance on screen.
    setLoyaltyBalance(null);
    if (!customer) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/pos/loyalty/balance?customer_id=${customer.id}`);
        if (!r.ok) return;
        const data = (await r.json()) as {
          balance?: number;
          settings?: typeof redeemSettings;
        };
        if (cancelled) return;
        if (typeof data.balance === "number") setLoyaltyBalance(data.balance);
        if (data.settings) setRedeemSettings(data.settings);
      } catch {
        /* swallow — loyalty offline; cashier proceeds without points */
      }
    })();
    return () => { cancelled = true; };
  }, [customer]);

  function applyRedemption(points: number, dollars: number) {
    setLines((prev) => [
      ...prev.filter((l) => l.line_type !== "loyalty_redemption"),
      {
        cart_id: cryptoId(),
        sku_id: null,
        epc: null,
        description: `Loyalty redemption · ${points} pts`,
        quantity: 1,
        unit_price: 0,
        discount_amount: dollars,
        tax_rate: 0,
        line_type: "loyalty_redemption",
        attributed_employee_id: saleAttributedEmployeeId,
      },
    ]);
    setShowRedeem(false);
  }

  // Public entry point — what /ItemSearch calls when the cashier picks
  // a row. If the catalog row is RFID-mode (is_manual_only=false), hold
  // the item and pop the confirm dialog instead of adding directly. The
  // dialog buttons route to addProductDirect() or the scan modal.
  function addProduct(item: SearchResultItem) {
    if (item.is_manual_only === false) {
      setRfidConfirmItem(item);
      return;
    }
    addProductDirect(item);
  }

  function addProductDirect(item: SearchResultItem, override?: { token: string; by: string }) {
    const price = Number(item.retail_price ?? 0);
    setLines((prev) => {
      // Manual rows stack on same sku_id — but ONLY with other manual
      // rows. An rfid row with the same sku_id is kept separate so the
      // mode-mismatch badge logic (WMS-driven) has both rows visible.
      const existing = prev.find(
        (l) =>
          l.sku_id === item.id &&
          l.line_type === "product" &&
          (l.source ?? "manual") === "manual",
      );
      if (existing) {
        return prev.map((l) =>
          l === existing
            ? {
                ...l,
                quantity: l.quantity + 1,
                ...(override ? { override_token: override.token, override_by: override.by } : {}),
              }
            : l,
        );
      }
      return [
        ...prev,
        {
          cart_id: cryptoId(),
          sku_id: item.id,
          epc: null,
          source: "manual",
          is_manual_only: item.is_manual_only ?? false,
          sku: item.sku ?? null,
          upc: item.upc ?? null,
          description: [item.item_name, item.color, item.size]
            .filter(Boolean)
            .join(" · "),
          image_url: item.image_url ?? null,
          quantity: 1,
          unit_price: price,
          list_price: price,
          discount_amount: 0,
          tax_rate: taxRate,
          line_type: "product",
          attributed_employee_id: saleAttributedEmployeeId,
          override_token: override?.token ?? null,
          override_by: override?.by ?? null,
        },
      ];
    });
  }

  function addRfidItems(items: RfidResolvedItem[]) {
    setLines((prev) => {
      const next: CartLine[] = [...prev];
      for (const it of items) {
        // Stack onto an existing rfid row for the same sku — pushes
        // the EPC into the row's `epcs` array and bumps qty. Manual
        // rows for the same sku stay separate.
        const existing = next.find(
          (l) =>
            l.sku_id === it.sku_id &&
            l.line_type === "product" &&
            l.source === "rfid",
        );
        if (existing) {
          const prevEpcs = existing.epcs ?? (existing.epc ? [existing.epc] : []);
          if (prevEpcs.includes(it.epc)) continue; // already in this row
          const merged: CartLine = {
            ...existing,
            quantity: existing.quantity + 1,
            epcs: [...prevEpcs, it.epc],
          };
          const idx = next.indexOf(existing);
          next[idx] = merged;
          continue;
        }
        next.push({
          cart_id: cryptoId(),
          sku_id: it.sku_id,
          epc: it.epc,
          epcs: [it.epc],
          source: "rfid",
          is_manual_only: it.is_manual_only ?? false,
          sku: it.sku,
          upc: it.upc,
          description: [it.item_name, it.color, it.size]
            .filter(Boolean)
            .join(" · "),
          image_url: it.image_url ?? null,
          quantity: 1,
          unit_price: Number(it.retail_price ?? 0),
          list_price: Number(it.retail_price ?? 0),
          discount_amount: 0,
          tax_rate: taxRate,
          line_type: "product",
          attributed_employee_id: saleAttributedEmployeeId,
        });
      }
      return next;
    });
  }

  function addMiscCharge(description: string, amount: number) {
    setLines((prev) => [
      ...prev,
      {
        cart_id: cryptoId(),
        sku_id: null,
        epc: null,
        description,
        quantity: 1,
        unit_price: amount,
        discount_amount: 0,
        tax_rate: taxRate,
        line_type: "misc",
        attributed_employee_id: saleAttributedEmployeeId,
      },
    ]);
  }

  /** Cart-header dropdown handler: rewrite EVERY line's attribution
   *  to this employee. Per the agreed UX, the header is the boss — any
   *  previous per-row overrides are cleared. */
  function setSaleAttribution(employeeId: number) {
    setSaleAttributedEmployeeId(employeeId);
    setLines((prev) =>
      prev.map((l) => ({ ...l, attributed_employee_id: employeeId })),
    );
  }

  /** Per-row dropdown handler: change one line's attribution; leaves the
   *  sale-wide header value alone. */
  function setLineAttribution(cartId: string, employeeId: number) {
    setLines((prev) =>
      prev.map((l) =>
        l.cart_id === cartId ? { ...l, attributed_employee_id: employeeId } : l,
      ),
    );
  }

  function changeQty(cartId: string, next: number) {
    setLines((prev) =>
      prev.map((l) => (l.cart_id === cartId ? { ...l, quantity: next } : l)),
    );
  }

  function removeLine(cartId: string) {
    setLines((prev) => prev.filter((l) => l.cart_id !== cartId));
  }

  /** Staff discount on one line. Replaces any automatic promotion on it;
   *  `approval` is the manager sign-off when the markdown needs one. */
  function applyLineDiscount(
    cartId: string,
    value: number,
    isPercent: boolean,
    approval?: Approval | null,
  ) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.cart_id !== cartId) return l;
        const subtotal = l.unit_price * l.quantity;
        const discount = isPercent
          ? Math.min(subtotal, subtotal * (Math.min(100, value) / 100))
          : Math.min(subtotal, value);
        return {
          ...l,
          discount_amount: Math.max(0, discount),
          ...manualDiscountMeta(approval),
        };
      }),
    );
  }

  /** Manual price override from the line editor's "Set Price" tab.
   *  Replaces unit_price and clears any previously-applied discount on
   *  that line (the cashier is restating the price from scratch — any
   *  prior % or $ off no longer makes sense against the new base). The
   *  catalog price stays in list_price for the approval check. */
  function setLinePrice(cartId: string, newPrice: number, approval?: Approval | null) {
    setLines((prev) =>
      prev.map((l) =>
        l.cart_id === cartId
          ? {
              ...l,
              list_price: l.list_price ?? l.unit_price,
              unit_price: Math.max(0, newPrice),
              discount_amount: 0,
              ...manualDiscountMeta(approval),
            }
          : l,
      ),
    );
  }

  /** Sale-wide discount, split across item lines by value. The loyalty
   *  redemption line keeps its own reward (it used to be wiped). */
  function applySaleDiscount(value: number, isPercent: boolean, approval?: Approval | null) {
    setLines((prev) => splitSaleDiscount(prev, value, isPercent, approval));
  }

  // Automatic promotions (Settings → Discounts). Re-evaluated whenever the
  // items, prices, quantities or customer change; staff discounts on a
  // line always win over a promotion.
  const promoKey = JSON.stringify([
    customer?.id ?? null,
    lines.map((l) => [l.cart_id, l.sku_id, l.unit_price, l.quantity, l.line_type, l.discount_source === "manual"]),
  ]);
  useEffect(() => {
    if (!hydrated) return;
    // Lines from carts saved before promotions existed carry a discount
    // with no source — treat those as staff discounts.
    const isManual = (l: CartLine) =>
      l.discount_source === "manual" || (l.discount_source == null && l.discount_amount > 0);
    const candidates = lines.filter((l) => l.line_type === "product" && !isManual(l));
    if (candidates.length === 0) return;
    const t = setTimeout(async () => {
      const r = await fetch("/api/pos/promotions/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: customer?.id ?? null,
          lines: candidates.map((l) => ({
            sku_id: l.sku_id,
            unit_price: l.unit_price,
            quantity: l.quantity,
            line_type: l.line_type,
          })),
        }),
      }).catch(() => null);
      if (!r?.ok) return;
      const { promos } = (await r.json()) as {
        promos: Array<{ rule_id: number; name: string; discount: number } | null>;
      };
      const byCart = new Map(candidates.map((l, i) => [l.cart_id, promos[i] ?? null]));
      setLines((prev) => {
        let changed = false;
        const next = prev.map((l) => {
          if (!byCart.has(l.cart_id) || isManual(l)) return l;
          const p = byCart.get(l.cart_id);
          if (p) {
            if (l.discount_source === "promo" && l.promo_rule_id === p.rule_id && Math.abs(l.discount_amount - p.discount) < 0.005) return l;
            changed = true;
            return { ...l, discount_amount: p.discount, discount_source: "promo" as const, promo_rule_id: p.rule_id, promo_name: p.name };
          }
          if (l.discount_source === "promo") {
            changed = true;
            return { ...l, discount_amount: 0, discount_source: null, promo_rule_id: null, promo_name: null };
          }
          return l;
        });
        return changed ? next : prev;
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoKey, hydrated]);

  /** Largest markdown fraction the discount would create (for the PIN check). */
  function previewMarkdown(target: string | "sale", payload: DiscountModalPayload): number {
    if (target === "sale") {
      if (payload.kind === "set-price") return 0;
      const after = splitSaleDiscount(lines, payload.value, payload.kind === "percent", null);
      return Math.max(0, ...after.filter((l) => l.line_type !== "loyalty_redemption" && l.line_type !== "return").map(markdownFraction));
    }
    const l = lines.find((x) => x.cart_id === target);
    if (!l) return 0;
    const subtotal = l.unit_price * l.quantity;
    if (payload.kind === "set-price") {
      return markdownFraction({ ...l, list_price: l.list_price ?? l.unit_price, unit_price: payload.value, discount_amount: 0 });
    }
    const d = payload.kind === "percent"
      ? Math.min(subtotal, subtotal * (Math.min(100, payload.value) / 100))
      : Math.min(subtotal, payload.value);
    return markdownFraction({ ...l, discount_amount: d });
  }

  async function refreshHeldCount() {
    const r = await fetch("/api/pos/held-sales").catch(() => null);
    if (r?.ok) setHeldCount(((await r.json()) as { held: unknown[] }).held.length);
  }
  useEffect(() => {
    void refreshHeldCount();
  }, []);

  /** Park the current cart server-side and start a fresh one. */
  async function holdCurrent(label: string | null): Promise<boolean> {
    if (lines.length === 0) return true;
    const r = await fetch("/api/pos/held-sales", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, customer, lines, total: totals.total }),
    }).catch(() => null);
    if (!r?.ok) return false;
    setLines([]);
    setCustomer(null);
    void refreshHeldCount();
    return true;
  }

  /** Bring a parked cart back (holding the current one first if needed). */
  async function resumeHeld(id: number): Promise<string | null> {
    if (lines.length > 0) {
      const ok = await holdCurrent("Held while resuming another sale");
      if (!ok) return "Couldn't hold the current cart first.";
    }
    const r = await fetch(`/api/pos/held-sales/${id}`, { method: "POST" }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as {
      cart?: { lines: CartLine[]; customer: PickedCustomer | null };
      message?: string;
    };
    if (!r?.ok || !d.cart) return d?.message ?? "Couldn't resume that sale.";
    setLines(d.cart.lines);
    setCustomer(d.cart.customer ?? null);
    void refreshHeldCount();
    return null;
  }

  async function startCheckout(method: "card" | "cash" | "other") {
    if (lines.length === 0) return;
    setOfflineNotice(null);
    if (pendingTags > 0) {
      setOfflineNotice(
        `Scan the tag${pendingTags === 1 ? "" : "s"} of the ${pendingTags} returned item${pendingTags === 1 ? "" : "s"} (Scan RFID) before checkout — every RFID item coming back must match the tag that was sold.`,
      );
      return;
    }
    // No connection to the server: cash can still be taken (queued on this
    // register and synced later); card and other tenders can't.
    if (!(await serverReachable())) {
      setOffline(true);
      if (method !== "cash") {
        setOfflineNotice("No internet — card and other payments need a connection. Take cash, or wait for the internet to come back.");
        return;
      }
      if (returnLines.length > 0 || lines.some((l) => l.line_type === "loyalty_redemption")) {
        setOfflineNotice("No internet — returns, exchanges and points redemptions need a connection. Remove them or wait.");
        return;
      }
      if (!registerId) {
        setOfflineNotice("No internet, and this register's id isn't known on this device yet — can't take an offline sale.");
        return;
      }
      setOfflineCash(true);
      return;
    }
    setOffline(false);
    const cart = encodeURIComponent(
      JSON.stringify({
        lines,
        totals,
        customerName: customer?.name ?? null,
        customerId: customer?.id ?? null,
        taxRate,
        attributedEmployeeId: saleAttributedEmployeeId,
      }),
    );
    router.push(`/sales/${code}/payment?method=${method}&cart=${cart}`);
  }

  /** Record the cart as an offline cash sale and start a fresh one. */
  function saveOfflineCashSale(cashGiven: number) {
    const total = totals.total;
    const uuid = crypto.randomUUID();
    enqueueOfflineSale({
      client_uuid: uuid,
      total,
      change: Math.round(Math.max(0, cashGiven - total) * 100) / 100,
      created_at: new Date().toISOString(),
      attempts: 0,
      error: null,
      payload: {
        register_id: registerId,
        customer_id: customer?.id ?? null,
        attributed_employee_id: saleAttributedEmployeeId,
        lines: captureLines(lines),
        payments: [{ method: "cash", amount: total, cash_given: cashGiven }],
        client_uuid: uuid,
        offline_recorded_at: new Date().toISOString(),
      },
    });
    setLines([]);
    setCustomer(null);
    setOfflineCash(false);
    const change = Math.max(0, cashGiven - total);
    setOfflineNotice(
      `Saved offline${change > 0 ? ` — give ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(change)} change` : ""}. It will sync and appear in Orders when the internet is back (print the receipt from there).`,
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6 flex flex-col space-y-4 sm:space-y-6">
      {offline && (
        <div className="border-2 border-amber-500 bg-amber-50 p-3 flex items-center gap-3">
          <span className="material-symbols-outlined text-amber-700" aria-hidden>cloud_off</span>
          <p className="text-sm text-amber-900">
            <span className="font-bold">Offline.</span> You can still take cash —
            sales are saved on this register and sync automatically when the
            internet is back. Card payments need a connection. Don&apos;t refresh or
            clear this browser.
          </p>
        </div>
      )}
      {offlineNotice && (
        <div className="border border-carbon-border bg-white p-3 flex items-start gap-3">
          <p className="text-sm flex-1">{offlineNotice}</p>
          <button onClick={() => setOfflineNotice(null)} className="text-carbon-text-muted px-2" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {offlineCash && (
        <OfflineCashModal
          total={totals.total}
          onCancel={() => setOfflineCash(false)}
          onConfirm={saveOfflineCashSale}
        />
      )}
      {returnSale && returnPanelOpen && (
        <ReturnPanel
          sale={returnSale}
          inCart={(lineId) => inCartReturns(lineId).length}
          pendingTags={pendingTags}
          onReturn={addReturnPiece}
          onReturnNoTag={(line) => {
            if (!returnSale) return;
            setOverrideReq({
              kind: "rfid_return",
              refId: String(returnSale.id),
              title: "Return without scanning the tag?",
              detail: `Take back "${line.description}" from receipt #${returnSale.sale_number} without scanning its RFID tag (it won't be put back in stock automatically).`,
              onApproved: (token, by) => {
                if (line.available_qty - inCartReturns(line.id).length <= 0) return;
                const l = returnLineFor(returnSale, line, null);
                setLines((prev) => [
                  ...prev,
                  { ...l, return_ref: { ...l.return_ref!, needs_tag: false, override_token: token, override_by: by } },
                ]);
              },
            });
          }}
          onScanTags={() => {
            markActivity();
            if (readerState === "off") void startReader();
            setShowRfid(true);
          }}
          onClose={() => setReturnPanelOpen(false)}
          onCancel={cancelReturn}
        />
      )}
      {returnSale && !returnPanelOpen && (
        <button
          type="button"
          onClick={() => setReturnPanelOpen(true)}
          className="self-start text-sm font-semibold text-red-700 underline"
        >
          Show receipt #{returnSale.sale_number} ({returnLines.length} returning
          {pendingTags ? `, ${pendingTags} tag${pendingTags === 1 ? "" : "s"} to scan` : ""})
        </button>
      )}
      {/* "Hello, Elior" — appears when a customer is attached and we have
          at least one item in cart. Sits above the cart per design. */}
      {customer && lines.length > 0 && (
        <div className="text-xl sm:text-2xl font-semibold text-carbon-text">
          Hello {customer.name.split(" ")[0]},
        </div>
      )}


      {/* Mobile-only: customer block pinned ABOVE the cart per operator
          directive. On lg+ the customer section lives inside the right-
          column TotalPanel (mode="all"), so this slot is hidden. */}
      <div className="lg:hidden">
        <TotalPanel
          returnMode={returnMode}
          mode="customer-only"
          totals={totals}
          customer={customer}
          loyaltyBalance={loyaltyBalance}
          redeemPaused={!redeemSettings.live}
              minRedeemPoints={redeemSettings.minRedeemPoints}
          onPickCustomer={setCustomer}
          onClearCustomer={() => setCustomer(null)}
          onNewCustomer={() => {
            router.push(
              `/customers/${code}/new?next=${encodeURIComponent(
                `/sales/${code}/new`,
              )}`,
            );
          }}
          onRedeemPoints={() => setShowRedeem(true)}
          onApplyDiscount={() => setDiscountFor("sale")}
          onChargeCard={() => startCheckout("card")}
          onTakeCash={() => startCheckout("cash")}
          onOtherPayment={() => startCheckout("other")}
          disabled={lines.length === 0}
          pendingPhone={pendingPhone}
          pendingFirstName={pendingFirstName}
          pendingLastName={pendingLastName}
          pendingEmail={pendingEmail}
          pendingCreateError={pendingCreateError}
          nameSendingToReader={nameSendingToReader}
          phonePromptCollecting={
            phonePromptStatus === "collecting" ||
            phonePromptStatus === "looking-up"
          }
          onChangePendingFirstName={(v) => { setPendingFirstName(v); setPendingCreateError(null); }}
          onChangePendingLastName={(v) => { setPendingLastName(v); setPendingCreateError(null); }}
          onChangePendingEmail={(v) => { setPendingEmail(v); setPendingCreateError(null); }}
          onSendNameToReader={sendNameToReader}
          onConfirmCreateCustomer={confirmCreateCustomer}
          onCancelPendingPhone={cancelPendingPhone}
          onCancelPhonePrompt={cancelPhonePrompt}
          onResendPhonePrompt={resendPhonePrompt}
        />
      </div>

      {/* Main POS area. Drops the side-by-side breakpoint from xl (1280)
          to lg (1024) so tablets in portrait get the stacked layout. */}
      <div className="flex flex-1 gap-4 sm:gap-6 min-h-0 flex-col lg:flex-row">
        {/* Left column — search + cart + bottom actions */}
        <div className="flex-1 flex flex-col space-y-4 min-w-0">
          {/* Search row: stacks under the Scan-RFID button on tiny phones
              (the button needs ~140 px and the search needs at least that
              wide to be useful), side-by-side from sm+. */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
            <div className="flex-1 min-w-0">
              <ItemSearch onPick={addProduct} onReceipt={loadReceipt} />
            </div>
            <button
              onClick={() => {
                markActivity();
                if (readerState === "off") void startReader();
                setShowRfid(true);
              }}
              title={readerStateLabel(readerState)}
              className="carbon-btn-secondary tap-lg px-4 sm:px-6 font-semibold whitespace-nowrap inline-flex items-center justify-center gap-2"
            >
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  readerDotClass(readerState)
                }`}
                aria-label={readerStateLabel(readerState)}
              />
              Scan RFID
            </button>
          </div>

          <CartPanel
            lines={lines}
            onChangeQty={changeQty}
            onRemove={removeLine}
            onEditDiscount={(id) => setDiscountFor(id)}
            saleNumberPreview={saleNumberPreview}
            employees={employees}
            saleAttributedEmployeeId={saleAttributedEmployeeId}
            onChangeSaleEmployee={setSaleAttribution}
            onChangeLineEmployee={setLineAttribution}
          />

          {/* Three secondary actions — flex-wrap so they reflow to 2+1 or
              stack on narrow widths instead of squishing the icons + labels. */}
          <div className="flex flex-wrap gap-2 sm:gap-4 pt-2">
            <button
              onClick={() => setShowMisc(true)}
              className="flex-1 min-w-[140px] carbon-btn-secondary tap font-semibold inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                add_circle
              </span>
              Misc Charge
            </button>
            <button
              onClick={() => setShowHold(true)}
              disabled={lines.length === 0}
              className="flex-1 min-w-[140px] carbon-btn-secondary tap font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                pause_circle
              </span>
              Hold Sale
            </button>
            <button
              onClick={() => setShowHeld(true)}
              className="flex-1 min-w-[140px] carbon-btn-secondary tap font-semibold inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                play_circle
              </span>
              Held Sales{heldCount > 0 ? ` (${heldCount})` : ""}
            </button>
            <button
              onClick={() => {
                setLines([]);
                setReturnSale(null);
                setReturnPanelOpen(false);
              }}
              disabled={lines.length === 0}
              className="flex-1 min-w-[140px] tap font-semibold border border-red-200 text-carbon-danger bg-white hover:bg-red-50 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                cancel
              </span>
              Clear All
            </button>
          </div>
        </div>

        {/* Right column — checkout. On lg+ this is the fixed 420 px
            sidebar with the FULL panel (customer + totals + payment).
            On mobile (<lg), customer already lives above the cart in
            the dedicated slot, so this slot renders summary-only
            (totals + payment buttons). */}
        <div className="lg:w-[420px] flex-shrink-0">
          {/* Mobile: summary-only (customer already shown above the cart). */}
          <div className="lg:hidden">
            <TotalPanel
          returnMode={returnMode}
              mode="summary-only"
              totals={totals}
              customer={customer}
              loyaltyBalance={loyaltyBalance}
              redeemPaused={!redeemSettings.live}
              minRedeemPoints={redeemSettings.minRedeemPoints}
              onPickCustomer={setCustomer}
              onClearCustomer={() => setCustomer(null)}
              onNewCustomer={() => {
                router.push(
                  `/customers/${code}/new?next=${encodeURIComponent(
                    `/sales/${code}/new`,
                  )}`,
                );
              }}
              onRedeemPoints={() => setShowRedeem(true)}
              onApplyDiscount={() => setDiscountFor("sale")}
              onChargeCard={() => startCheckout("card")}
              onTakeCash={() => startCheckout("cash")}
              onOtherPayment={() => startCheckout("other")}
              disabled={lines.length === 0}
              pendingPhone={pendingPhone}
              pendingFirstName={pendingFirstName}
              pendingLastName={pendingLastName}
              pendingEmail={pendingEmail}
              pendingCreateError={pendingCreateError}
              nameSendingToReader={nameSendingToReader}
              phonePromptCollecting={
                phonePromptStatus === "collecting" ||
                phonePromptStatus === "looking-up"
              }
              onChangePendingFirstName={(v) => { setPendingFirstName(v); setPendingCreateError(null); }}
              onChangePendingLastName={(v) => { setPendingLastName(v); setPendingCreateError(null); }}
              onChangePendingEmail={(v) => { setPendingEmail(v); setPendingCreateError(null); }}
              onSendNameToReader={sendNameToReader}
              onConfirmCreateCustomer={confirmCreateCustomer}
              onCancelPendingPhone={cancelPendingPhone}
              onCancelPhonePrompt={cancelPhonePrompt}
              onResendPhonePrompt={resendPhonePrompt}
            />
          </div>
          {/* Desktop: full panel — customer + totals + payment buttons. */}
          <div className="hidden lg:block">
            <TotalPanel
          returnMode={returnMode}
              mode="all"
              totals={totals}
              customer={customer}
              loyaltyBalance={loyaltyBalance}
              redeemPaused={!redeemSettings.live}
              minRedeemPoints={redeemSettings.minRedeemPoints}
              onPickCustomer={setCustomer}
              onClearCustomer={() => setCustomer(null)}
              onNewCustomer={() => {
                router.push(
                  `/customers/${code}/new?next=${encodeURIComponent(
                    `/sales/${code}/new`,
                  )}`,
                );
              }}
              onRedeemPoints={() => setShowRedeem(true)}
              onApplyDiscount={() => setDiscountFor("sale")}
              onChargeCard={() => startCheckout("card")}
              onTakeCash={() => startCheckout("cash")}
              onOtherPayment={() => startCheckout("other")}
              disabled={lines.length === 0}
              pendingPhone={pendingPhone}
              pendingFirstName={pendingFirstName}
              pendingLastName={pendingLastName}
              pendingEmail={pendingEmail}
              pendingCreateError={pendingCreateError}
              nameSendingToReader={nameSendingToReader}
              phonePromptCollecting={
                phonePromptStatus === "collecting" ||
                phonePromptStatus === "looking-up"
              }
              onChangePendingFirstName={(v) => { setPendingFirstName(v); setPendingCreateError(null); }}
              onChangePendingLastName={(v) => { setPendingLastName(v); setPendingCreateError(null); }}
              onChangePendingEmail={(v) => { setPendingEmail(v); setPendingCreateError(null); }}
              onSendNameToReader={sendNameToReader}
              onConfirmCreateCustomer={confirmCreateCustomer}
              onCancelPendingPhone={cancelPendingPhone}
              onCancelPhonePrompt={cancelPhonePrompt}
              onResendPhonePrompt={resendPhonePrompt}
            />
          </div>
          {customer && loyaltyBalance !== null && redeemSettings.live ? (
            <RedeemPointsModal
              open={showRedeem}
              customer={{ name: customer.name }}
              balance={loyaltyBalance}
              subtotal={totals.subtotal}
              redeemPointsPerDollar={redeemSettings.redeemPointsPerDollar}
              redeemIncrement={redeemSettings.redeemIncrement}
              minRedeemPoints={redeemSettings.minRedeemPoints}
              maxPctOfOrder={redeemSettings.maxPctOfOrder}
              maxDollarsPerOrder={redeemSettings.maxDollarsPerOrder ?? 30}
              onConfirm={applyRedemption}
              onClose={() => setShowRedeem(false)}
            />
          ) : null}
        </div>
      </div>

      <RFIDScanModal
        open={showRfid}
        onClose={() => setShowRfid(false)}
        onAdd={addRfidItems}
        returnEpcs={returnSale ? returnableEpcs : undefined}
        returnLabel={returnSale ? `#${returnSale.sale_number}` : undefined}
        onReturn={applyReturnTags}
        readerState={readerState}
        cartEpcs={lines.flatMap((l) => {
          // Rows that source='rfid' stack multiple EPCs into l.epcs[].
          // We must dedupe against ALL of them, not just the first one
          // — otherwise re-opening the scan modal would still surface
          // tags that are already in the cart on a stacked row.
          const stacked = l.epcs ?? [];
          if (stacked.length > 0) return stacked;
          return typeof l.epc === "string" && l.epc.length > 0 ? [l.epc] : [];
        })}
      />
      {showMisc && (
        <MiscChargeModal
          onCancel={() => setShowMisc(false)}
          onAdd={(desc, amt) => {
            addMiscCharge(desc, amt);
            setShowMisc(false);
          }}
        />
      )}
      {showHold && (
        <HoldSaleModal
          customerName={customer?.name ?? null}
          onCancel={() => setShowHold(false)}
          onHold={async (label) => {
            const ok = await holdCurrent(label);
            if (ok) setShowHold(false);
            return ok;
          }}
        />
      )}
      {showHeld && (
        <HeldSalesModal
          cartHasItems={lines.length > 0}
          onClose={() => {
            setShowHeld(false);
            void refreshHeldCount();
          }}
          onResume={async (id) => {
            const err = await resumeHeld(id);
            if (!err) setShowHeld(false);
            return err;
          }}
        />
      )}
      {discountFor && (
        <DiscountModal
          target={discountFor}
          currentPrice={
            discountFor === "sale"
              ? undefined
              : lines.find((l) => l.cart_id === discountFor)?.unit_price
          }
          previewMarkdown={(payload) => previewMarkdown(discountFor, payload)}
          onCancel={() => setDiscountFor(null)}
          onApply={(payload, approval) => {
            if (payload.kind === "set-price") {
              if (discountFor !== "sale") setLinePrice(discountFor, payload.value, approval);
            } else if (discountFor === "sale") {
              applySaleDiscount(payload.value, payload.kind === "percent", approval);
            } else {
              applyLineDiscount(discountFor, payload.value, payload.kind === "percent", approval);
            }
            setDiscountFor(null);
          }}
        />
      )}
      {rfidConfirmItem && (
        <RfidConfirmModal
          item={rfidConfirmItem}
          onProcessManual={() => {
            const it = rfidConfirmItem;
            setRfidConfirmItem(null);
            setOverrideReq({
              kind: "rfid_sale",
              refId: it.id,
              title: "Sell without scanning the tag?",
              detail: `Sell "${[it.item_name, it.color, it.size].filter(Boolean).join(" · ")}" (SKU ${it.sku ?? "—"}) without scanning its RFID tag.`,
              onApproved: (token, by) => addProductDirect(it, { token, by }),
            });
          }}
          onScanRfid={() => {
            setRfidConfirmItem(null);
            markActivity();
            if (readerState === "off") void startReader();
            setShowRfid(true);
          }}
          onCancel={() => setRfidConfirmItem(null)}
        />
      )}
      {overrideReq && (
        <OverrideModal
          kind={overrideReq.kind}
          refId={overrideReq.refId}
          title={overrideReq.title}
          detail={overrideReq.detail}
          onCancel={() => setOverrideReq(null)}
          onApproved={(token, by) => {
            overrideReq.onApproved(token, by);
            setOverrideReq(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Shown when the cashier picks an item whose catalog row is RFID-mode
 * (matrices.is_manual_only=false). The expected path for those items is
 * a tag scan — entering them by hand defeats inventory tracking, so we
 * make the cashier confirm. The two exits:
 *
 *   Process Manually — adds the item with the red-radio mismatch badge
 *                      so WMS sees it was hand-entered.
 *   Scan RFID        — wakes the reader if needed and opens the scan
 *                      modal; the cashier asks the customer to bring
 *                      the item to the reader.
 */
function RfidConfirmModal({
  item,
  onProcessManual,
  onScanRfid,
  onCancel,
}: {
  item: SearchResultItem;
  onProcessManual: () => void;
  onScanRfid: () => void;
  onCancel: () => void;
}) {
  const desc = [item.item_name, item.color, item.size].filter(Boolean).join(" · ");
  return (
    <>
      <button
        type="button"
        aria-label="Close"
        className="fixed inset-0 z-[60] bg-black/60"
        onClick={onCancel}
      />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="w-full max-w-md carbon-card shadow-2xl">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="shrink-0 w-12 h-12 rounded-full bg-carbon-blue-soft text-carbon-blue inline-flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px]" aria-hidden>
                  radio
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-carbon-text">
                  This item has an RFID tag
                </h3>
                <p className="mt-1 text-sm text-carbon-text-muted leading-snug">
                  {desc} is normally scanned with the reader. Adding it
                  by hand skips tag tracking and shows a mismatch flag
                  on this sale.
                </p>
              </div>
            </div>
          </div>
          <div className="px-6 pb-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={onScanRfid}
              className="w-full carbon-btn-primary tap-lg text-base font-bold inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                radio
              </span>
              Scan RFID
            </button>
            <button
              type="button"
              onClick={onProcessManual}
              className="w-full tap font-semibold border border-red-200 text-carbon-danger bg-white hover:bg-red-50 transition-colors inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                radio
              </span>
              Process Manually
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full carbon-btn-secondary tap font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function MiscChargeModal({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (description: string, amount: number) => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <BasicModal title="Misc Charge" onCancel={onCancel}>
      <p className="text-[var(--color-pos-muted)]">
        For items not in the catalog. Don&apos;t use this if a barcode exists.
      </p>
      <label className="block mt-3 text-sm font-medium">Description</label>
      <input
        autoFocus
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="tap w-full border border-[var(--color-pos-border)] px-3 mt-1"
      />
      <label className="block mt-3 text-sm font-medium">Amount</label>
      <input
        type="number"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="tap-lg w-full border border-[var(--color-pos-border)] px-3 text-2xl font-semibold mt-1"
      />
      <div className="mt-5 flex gap-2">
        <button
          onClick={onCancel}
          className="tap border border-[var(--color-pos-border)] flex-1 font-medium"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const n = Number(amount);
            if (!description.trim() || !Number.isFinite(n) || n <= 0) return;
            onAdd(description.trim(), n);
          }}
          className="tap carbon-btn-primary flex-1 font-semibold"
        >
          Add
        </button>
      </div>
    </BasicModal>
  );
}

type DiscountModalPayload =
  | { kind: "percent"; value: number }
  | { kind: "fixed"; value: number }
  | { kind: "set-price"; value: number };





/**
 * Receipt loaded for a return / exchange: every item on the sale with
 * what's still returnable. "−1 Return" adds a negative cart line; RFID
 * pieces then need their tag scanned (Scan RFID) to verify it's the
 * piece that was sold.
 */
function ReturnPanel({
  sale,
  inCart,
  pendingTags,
  onReturn,
  onReturnNoTag,
  onScanTags,
  onClose,
  onCancel,
}: {
  sale: ReturnableSale;
  inCart: (lineId: number) => number;
  pendingTags: number;
  onReturn: (line: ReturnableLine) => void;
  /** RFID piece back without its tag — needs an admin override. */
  onReturnNoTag: (line: ReturnableLine) => void;
  onScanTags: () => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  const lines = sale.lines.filter((l) => l.line_type !== "loyalty_redemption");
  return (
    <div className="border-2 border-red-600 bg-white">
      <div className="bg-red-600 text-white px-4 py-2 flex flex-wrap items-center gap-2">
        <span className="material-symbols-outlined" aria-hidden>assignment_return</span>
        <span className="font-bold flex-1">
          Return from receipt #{sale.sale_number}
          {sale.completed_at
            ? ` · ${new Date(sale.completed_at).toLocaleDateString("en-US", { timeZone: "America/New_York" })}`
            : ""}
          {sale.customer?.name ? ` · ${sale.customer.name}` : ""}
        </span>
        <span className="text-sm">Refundable left {fmt(sale.remaining)}</span>
      </div>
      {sale.status === "voided" ? (
        <p className="p-4 text-red-700 font-semibold">This sale was voided — nothing to return.</p>
      ) : (
        <ul className="divide-y divide-carbon-border-soft">
          {lines.map((l) => {
            const left = l.available_qty - inCart(l.id);
            const tagged = l.epcs.length > 0;
            return (
              <li key={l.id} className="px-4 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{l.description}</p>
                  <p className="text-xs text-carbon-text-muted">
                    Sold {l.quantity} · {fmt(l.unit_value)} each
                    {l.returned_qty ? ` · ${l.returned_qty} already returned` : ""}
                    {inCart(l.id) ? ` · ${inCart(l.id)} returning now` : ""}
                    {tagged ? " · RFID — scan to verify" : " · no tag"}
                  </p>
                </div>
                {tagged && (
                  <button
                    type="button"
                    disabled={left <= 0}
                    onClick={() => onReturnNoTag(l)}
                    title="Tag missing or unreadable — needs an admin override"
                    className="tap border border-amber-500 text-amber-800 px-2 text-xs font-semibold disabled:opacity-30"
                  >
                    Return w/o tag
                  </button>
                )}
                <button
                  type="button"
                  disabled={left <= 0}
                  onClick={() => onReturn(l)}
                  className="tap border-2 border-red-600 text-red-700 px-3 font-bold disabled:opacity-30 disabled:border-carbon-border disabled:text-carbon-text-muted"
                >
                  −1 Return
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="px-4 py-3 bg-[var(--carbon-surface-soft)] flex flex-wrap items-center gap-3 border-t border-carbon-border-soft">
        <p className="text-sm flex-1 min-w-[200px]">
          {pendingTags > 0 ? (
            <span className="text-amber-800 font-semibold">
              {pendingTags} returned item{pendingTags === 1 ? "" : "s"} waiting for a tag scan.
            </span>
          ) : (
            <span className="text-carbon-text-muted">
              Tip: scanning the tags (Scan RFID) also adds them as returns.
            </span>
          )}{" "}
          Then scan the new items — the cart shows the difference.
        </p>
        <button type="button" onClick={onScanTags} className="tap carbon-btn-primary px-4 font-semibold">
          Scan returned tags
        </button>
        <button type="button" onClick={onClose} className="tap carbon-btn-secondary px-4 font-semibold">
          Hide
        </button>
        <button type="button" onClick={onCancel} className="tap border border-red-300 text-red-700 px-4 font-semibold bg-white">
          Cancel return
        </button>
      </div>
    </div>
  );
}

function OfflineCashModal({
  total,
  onCancel,
  onConfirm,
}: {
  total: number;
  onCancel: () => void;
  onConfirm: (cashGiven: number) => void;
}) {
  const [given, setGiven] = useState("");
  const ok = Number(given || 0) + 0.005 >= total;
  return (
    <BasicModal title="Offline cash sale" onCancel={onCancel}>
      <p className="text-sm text-amber-800 mt-1">
        No internet. This sale is saved on this register and syncs when the
        connection is back. The receipt can be printed from Orders after it
        syncs.
      </p>
      <div className="mt-3">
        <CashKeypad value={given} onChange={setGiven} total={total} />
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={onCancel} className="tap border border-[var(--color-pos-border)] flex-1 font-medium">
          Cancel
        </button>
        <button
          disabled={!ok}
          onClick={() => onConfirm(Math.round(Number(given) * 100) / 100)}
          className="tap carbon-btn-primary flex-1 font-semibold disabled:opacity-50"
        >
          Save cash sale
        </button>
      </div>
    </BasicModal>
  );
}

function HoldSaleModal({
  customerName,
  onCancel,
  onHold,
}: {
  customerName: string | null;
  onCancel: () => void;
  onHold: (label: string | null) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(customerName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <BasicModal title="Hold this sale" onCancel={onCancel}>
      <p className="text-sm text-carbon-text-muted mt-1">
        Parks the cart so you can ring up someone else. Resume it any time
        from Held Sales — on any register at this store.
      </p>
      <input
        autoFocus
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name or note (e.g. 'Lady in fitting room 2')"
        className="tap w-full border border-[var(--color-pos-border)] px-3 mt-3"
      />
      {error && <p className="text-sm text-[var(--color-pos-danger)] mt-2">{error}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={onCancel} className="tap border border-[var(--color-pos-border)] flex-1 font-medium">
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await onHold(label.trim() || null);
            setBusy(false);
            if (!ok) setError("Couldn't hold the sale. Try again.");
          }}
          className="tap carbon-btn-primary flex-1 font-semibold disabled:opacity-50"
        >
          {busy ? "Holding…" : "Hold Sale"}
        </button>
      </div>
    </BasicModal>
  );
}

type HeldRow = {
  id: number;
  label: string | null;
  customer_name: string | null;
  item_count: number;
  total: string;
  created_at: string;
  held_by: string | null;
};

function HeldSalesModal({
  cartHasItems,
  onClose,
  onResume,
}: {
  cartHasItems: boolean;
  onClose: () => void;
  onResume: (id: number) => Promise<string | null>;
}) {
  const [rows, setRows] = useState<HeldRow[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    const r = await fetch("/api/pos/held-sales").catch(() => null);
    setRows(r?.ok ? ((await r.json()) as { held: HeldRow[] }).held : []);
  }
  useEffect(() => {
    void load();
  }, []);
  const ago = (iso: string) => {
    const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  return (
    <BasicModal title="Held sales" onCancel={onClose}>
      {cartHasItems && (
        <p className="text-xs text-carbon-text-muted mt-1">
          Resuming holds your current cart first, so nothing is lost.
        </p>
      )}
      {error && <p className="text-sm text-[var(--color-pos-danger)] mt-2">{error}</p>}
      {rows === null ? (
        <p className="text-sm text-carbon-text-muted mt-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-carbon-text-muted mt-3">No held sales.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-pos-border)] max-h-[50vh] overflow-y-auto">
          {rows.map((h) => (
            <li key={h.id} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">
                  {h.label || h.customer_name || `Held sale #${h.id}`}
                </p>
                <p className="text-xs text-carbon-text-muted">
                  {h.item_count} item{h.item_count === 1 ? "" : "s"} ·{" "}
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(h.total))}{" "}
                  · {ago(h.created_at)}
                  {h.held_by ? ` · by ${h.held_by}` : ""}
                </p>
              </div>
              <button
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(h.id);
                  setError(null);
                  const err = await onResume(h.id);
                  setBusy(null);
                  if (err) {
                    setError(err);
                    void load();
                  }
                }}
                className="tap carbon-btn-primary px-4 font-semibold disabled:opacity-50"
              >
                {busy === h.id ? "…" : "Resume"}
              </button>
              <button
                disabled={busy !== null}
                onClick={async () => {
                  if (!confirm("Delete this held sale?")) return;
                  await fetch(`/api/pos/held-sales/${h.id}`, { method: "DELETE" });
                  void load();
                }}
                className="tap border border-red-200 text-carbon-danger px-3 disabled:opacity-50"
                aria-label="Delete held sale"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden>delete</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </BasicModal>
  );
}


type Approval = { token: string; approver: string };

function manualDiscountMeta(approval?: Approval | null) {
  return {
    discount_source: "manual" as const,
    promo_rule_id: null,
    promo_name: null,
    discount_approval: approval?.token ?? null,
    discount_approved_by: approval?.approver ?? null,
  };
}

/** Spread a sale-wide discount over the item lines by value. */
function splitSaleDiscount(
  lines: CartLine[],
  value: number,
  isPercent: boolean,
  approval: Approval | null | undefined,
): CartLine[] {
  const items = lines.filter((l) => l.line_type !== "loyalty_redemption" && l.line_type !== "return");
  const subtotal = items.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  if (subtotal <= 0) return lines;
  const total = isPercent
    ? subtotal * (Math.min(100, value) / 100)
    : Math.min(subtotal, value);
  return lines.map((l) => {
    if (l.line_type === "loyalty_redemption" || l.line_type === "return") return l;
    const lineSubtotal = l.unit_price * l.quantity;
    const share = lineSubtotal / subtotal;
    return {
      ...l,
      discount_amount: Math.max(0, Math.round(total * share * 100) / 100),
      ...manualDiscountMeta(approval),
    };
  });
}

function DiscountModal({
  target,
  currentPrice,
  previewMarkdown,
  onCancel,
  onApply,
}: {
  target: string | "sale";
  /** Current unit_price of the line being edited — pre-fills the input
   *  when the cashier switches to the "Set Price" tab. Omitted for the
   *  sale-wide modal (which doesn't expose Set Price). */
  currentPrice?: number;
  /** Markdown fraction this discount would create (0..1). */
  previewMarkdown: (payload: DiscountModalPayload) => number;
  onCancel: () => void;
  onApply: (payload: DiscountModalPayload, approval: Approval | null) => void;
}) {
  // Manager approval step for markdowns over the policy threshold.
  const [pinFor, setPinFor] = useState<DiscountModalPayload | null>(null);
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  async function requestApproval(payload: DiscountModalPayload, withPin?: string) {
    setPinBusy(true);
    setPinError(null);
    const r = await fetch("/api/pos/auth/manager-approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(withPin ? { pin: withPin } : {}),
    }).catch(() => null);
    setPinBusy(false);
    if (r?.ok) {
      const d = (await r.json()) as Approval;
      onApply(payload, d);
      return;
    }
    const d = (await r?.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!withPin && d?.error === "pin_required") {
      setPinFor(payload);
      return;
    }
    setPinError(d?.message ?? "Couldn't verify the PIN.");
    setPin("");
  }

  function submit(payload: DiscountModalPayload) {
    if (needsManagerApproval(previewMarkdown(payload))) {
      void requestApproval(payload);
    } else {
      onApply(payload, null);
    }
  }
  const isLine = target !== "sale";
  const [mode, setMode] = useState<"percent" | "fixed" | "set-price">(
    "percent",
  );
  const [value, setValue] = useState("");
  // Pre-fill with the current price the first time the cashier flips to
  // Set Price so they can edit instead of retyping. Switching back to a
  // discount mode wipes the field so the % / $ doesn't inherit a price.
  function changeMode(next: "percent" | "fixed" | "set-price") {
    setMode(next);
    if (next === "set-price" && currentPrice != null) {
      setValue(currentPrice.toFixed(2));
    } else {
      setValue("");
    }
  }
  const title = isLine
    ? mode === "set-price"
      ? "Set line price"
      : "Discount line"
    : "Discount the whole sale";
  const placeholder =
    mode === "percent" ? "10" : mode === "fixed" ? "5.00" : "12.99";
  const applyLabel = mode === "set-price" ? "Set Price" : "Apply";
  return (
    <BasicModal title={title} onCancel={onCancel}>
      <div className={`grid ${isLine ? "grid-cols-3" : "grid-cols-2"} gap-2 mt-2`}>
        <button
          onClick={() => changeMode("percent")}
          className={`tap border ${
            mode === "percent"
              ? "carbon-btn-primary"
              : "border-[var(--color-pos-border)]"
          }`}
        >
          % Off
        </button>
        <button
          onClick={() => changeMode("fixed")}
          className={`tap border ${
            mode === "fixed"
              ? "carbon-btn-primary"
              : "border-[var(--color-pos-border)]"
          }`}
        >
          $ Off
        </button>
        {isLine ? (
          <button
            onClick={() => changeMode("set-price")}
            className={`tap border ${
              mode === "set-price"
                ? "carbon-btn-primary"
                : "border-[var(--color-pos-border)]"
            }`}
          >
            Set Price
          </button>
        ) : null}
      </div>
      <input
        autoFocus
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="tap-lg w-full border border-[var(--color-pos-border)] px-3 text-3xl font-semibold mt-3"
      />
      {Number(value) > 0 &&
        needsManagerApproval(previewMarkdown({ kind: mode, value: Number(value) })) && (
          <p className="text-xs text-amber-700 mt-2">
            {Math.round(previewMarkdown({ kind: mode, value: Number(value) }) * 100)}% off —
            over 20% needs a manager&apos;s PIN.
          </p>
        )}
      {pinFor && (
        <div className="mt-3 border border-amber-400 bg-amber-50 p-3">
          <p className="text-sm font-semibold mb-2">Manager PIN to approve</p>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(v);
              if (v.length === 4) void requestApproval(pinFor, v);
            }}
            placeholder="••••"
            className="tap-lg w-full border border-[var(--color-pos-border)] px-3 text-3xl tracking-[0.5em] text-center"
          />
          {pinBusy && <p className="text-xs mt-1">Checking…</p>}
          {pinError && <p className="text-xs text-[var(--color-pos-danger)] mt-1">{pinError}</p>}
        </div>
      )}
      {mode === "set-price" && (
        <p className="text-xs text-carbon-text-muted mt-2 leading-snug">
          Replaces the line price. Any % / $ off on this line is cleared —
          re-apply afterwards if needed.
        </p>
      )}
      <div className="mt-5 flex gap-2">
        <button
          onClick={onCancel}
          className="tap border border-[var(--color-pos-border)] flex-1 font-medium"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0) return;
            // Discounts must be > 0 (zero discount is a no-op); a set
            // price of 0 is legitimate (promo giveaway).
            if (mode !== "set-price" && n <= 0) return;
            submit({ kind: mode, value: n });
          }}
          disabled={pinBusy}
          className="tap carbon-btn-primary flex-1 font-semibold"
        >
          {applyLabel}
        </button>
      </div>
    </BasicModal>
  );
}

function BasicModal({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full sm:max-w-md p-6 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            onClick={onCancel}
            className="text-[var(--color-pos-muted)] text-xl leading-none px-2"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Stable id for cart rows. */
function cryptoId(): string {
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis.crypto as Crypto | undefined)?.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}


/**
 * Small status-dot CSS class for the dot embedded in the Scan RFID
 * button. Green when chip alive, amber/pulse during transitions or
 * watchdog recovery, red when unreachable, gray for off/no-reader.
 */
type ReaderUiState =
  | "off"
  | "on"
  | "recovering"
  | "starting"
  | "stopping"
  | "no_reader"
  | "unreachable";

function readerDotClass(state: ReaderUiState): string {
  switch (state) {
    case "on":
      return "bg-emerald-500";
    case "recovering":
    case "starting":
    case "stopping":
      return "bg-amber-400 animate-pulse";
    case "unreachable":
      return "bg-red-500";
    case "no_reader":
    case "off":
    default:
      return "bg-carbon-text-muted/40";
  }
}

function readerStateLabel(state: ReaderUiState): string {
  switch (state) {
    case "on":
      return "Reader ready — tap to scan";
    case "off":
      return "Reader off — tap to start";
    case "recovering":
      return "Reader recovering…";
    case "starting":
      return "Starting reader…";
    case "stopping":
      return "Stopping reader…";
    case "no_reader":
      return "No reader paired with this register";
    case "unreachable":
      return "Reader unreachable — check WMS";
  }
}
