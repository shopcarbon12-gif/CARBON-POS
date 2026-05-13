"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ItemSearch, type SearchResultItem } from "./ItemSearch";
import { CartPanel } from "./CartPanel";
import { TotalPanel, type PickedCustomer } from "./TotalPanel";
import { RedeemPointsModal } from "./RedeemPointsModal";
import { RFIDScanModal, type RfidResolvedItem } from "./RFIDScanModal";
import { calculateTotals } from "@/lib/tax";
import type { CartLine } from "@/types/pos";

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
}: {
  taxRate: number;
  /** Active location code (e.g. "003") — used to build navigation URLs. */
  code: string;
  /** Kept for backward-compat; the AdminShell now handles sign-out. */
  onSignOut?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [showRfid, setShowRfid] = useState(false);
  const [showMisc, setShowMisc] = useState(false);
  const [discountFor, setDiscountFor] = useState<string | "sale" | null>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [hydrated, setHydrated] = useState(false);

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
  const [nameDrawerOpen, setNameDrawerOpen] = useState(false);
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

  // Map a WMS state response → ReaderState. Called by both the manual
  // start/stop flow and the background reconcile.
  const mapWmsState = (r: {
    skipped?: boolean;
    reason?: string;
    live_scan_active?: boolean;
    reader_status_online?: boolean;
  }): ReaderState | null => {
    if (r.skipped && r.reason === "no_agent") return "no_reader";
    if (typeof r.live_scan_active !== "boolean") return null;
    if (!r.live_scan_active) return "off";
    // Active. Chip alive?
    if (r.reader_status_online === true) return "on";
    if (r.reader_status_online === false) return "recovering";
    return "on"; // optimistic when truthiness unknown
  };

  const fetchState = async (): Promise<ReaderState | null> => {
    try {
      const r = await fetch("/api/pos/hardware/reader/state").then((r) =>
        r.json(),
      );
      return mapWmsState(r);
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

  // Auto-start on mount, auto-stop on unmount. The unmount path covers
  // sale completion (capture redirects to /receipt), tab close, and
  // navigation to other tabs.
  useEffect(() => {
    void startReader();
    return () => {
      // Two best-effort, fire-and-forget calls on unmount:
      //  1. Cancel any in-flight Stripe action on the reader (the
      //     phone-prompt collect_inputs, the name-prompt, or the cart
      //     display) so the pinpad returns to the Carbon splash
      //     instead of staying stuck on the last screen.
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
      void Promise.allSettled([cancelStripe, stopScan]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 5-minute idle watchdog. Resets on any cart change, search input,
  // discount edit, or Scan RFID click (see callers of `markActivity`).
  useEffect(() => {
    const id = setInterval(() => {
      if (readerState !== "on") return;
      if (Date.now() - lastActivityRef.current > 5 * 60 * 1000) {
        void stopReader();
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [readerState]);

  // Cart mutations are the primary "cashier is doing things" signal —
  // bumps the activity ref so the idle-stop timer doesn't fire mid-sale.
  // We avoid wrapping every setLines call by reacting to `lines` here.
  useEffect(() => {
    if (!hydrated) return;
    lastActivityRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length]);

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
      const fast = Date.now() < fastPollUntilRef.current;
      const next = await fetchState();
      if (cancelled) return;
      if (next === "unreachable") {
        if (unreachableSince === 0) unreachableSince = Date.now();
        setReaderState("unreachable");
        // If we've been unreachable for 30s, try kicking Start once.
        // The agent restart or network recovery will let the next tick
        // land a real state.
        if (Date.now() - unreachableSince > 30_000) {
          unreachableSince = 0;
          void startReader();
        }
      } else if (next) {
        unreachableSince = 0;
        // Don't clobber "starting"/"stopping" while their fetch is in
        // flight — those resolve themselves via the response path.
        setReaderState((cur) =>
          cur === "starting" || cur === "stopping" ? next : next,
        );
      }
      timer = setTimeout(tick, fast ? 3_000 : 20_000);
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
    if (restoredLines.length) setLines(restoredLines);
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
      setNameDrawerOpen(false);
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
              customer?: { id: number; first_name: string; last_name: string | null; email: string | null; phone: string | null; mobile_phone: string | null };
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
              phone: c.mobile_phone ?? c.phone ?? null,
            });
            setPhonePromptStatus("done");
          } else {
            // No match — surface the pending phone for cashier
            // confirmation. Reader returns to the Carbon splash on its
            // own (Stripe transitions out of collect_inputs as soon as
            // the customer submits).
            setPendingPhone(lookup.phone ?? r.phone);
            setPendingFirstName("");
            setPendingLastName("");
            setPhonePromptStatus("idle");
          }
          handlingResultRef.current = false;
        } else if (
          r.status === "canceled" ||
          r.status === "failed" ||
          r.status === "idle"
        ) {
          setPhonePromptStatus("idle");
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


  // Poll the reader's name-prompt action while the cashier has it open.
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
          if (r.first_name) setPendingFirstName(r.first_name);
          if (r.last_name) setPendingLastName(r.last_name);
          setNameSendingToReader(false);
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
  }, [nameSendingToReader]);

  // Cashier-side skip: cancels the reader action and stops the prompt.
  const cancelPhonePrompt = () => {
    setPhonePromptStatus("idle");
    fetch("/api/pos/loyalty/reader-prompt", { method: "DELETE" }).catch(
      () => {},
    );
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
    setNameDrawerOpen(false);
    setNameSendingToReader(false);
    fetch("/api/pos/loyalty/reader-prompt", { method: "DELETE" }).catch(
      () => {},
    );
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

  const confirmCreateCustomer = async () => {
    if (!pendingPhone) return;
    const first = pendingFirstName.trim();
    if (!first) return;
    try {
      const res = await fetch("/api/pos/loyalty/create-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: pendingPhone,
          first_name: first,
          last_name: pendingLastName.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.customer) {
        const c = data.customer;
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
        setCustomer({
          id: c.id,
          name,
          email: c.email ?? null,
          phone: c.mobile_phone ?? c.phone ?? null,
        });
        // Cancel any in-flight reader action so cart-mirror can take over.
        fetch("/api/pos/loyalty/reader-prompt", { method: "DELETE" }).catch(
          () => {},
        );
        setPendingPhone(null);
        setPendingFirstName("");
        setPendingLastName("");
        setNameDrawerOpen(false);
        setNameSendingToReader(false);
        setPhonePromptStatus("done");
      }
    } catch {
      /* leave UI as-is so cashier can retry */
    }
  };

  // ── Loyalty integration ─────────────────────────────────────────────
  // When a customer is attached, fetch their balance from
  // /api/pos/loyalty/balance (a thin proxy on POS that calls
  // loyalty.shopcarbon.com server-side with the API key). Cleared on
  // detach. RedeemPointsModal is gated on having a balance + subtotal.
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [redeemSettings, setRedeemSettings] = useState<{
    redeemPointsPerDollar: number;
    redeemIncrement: number;
    minRedeemPoints: number;
    maxPctOfOrder: number;
  }>({ redeemPointsPerDollar: 10, redeemIncrement: 100, minRedeemPoints: 100, maxPctOfOrder: 50 });
  const [showRedeem, setShowRedeem] = useState(false);

  useEffect(() => {
    if (!customer) {
      setLoyaltyBalance(null);
      return;
    }
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
      },
    ]);
    setShowRedeem(false);
  }

  function addProduct(item: SearchResultItem) {
    const price = Number(item.retail_price ?? 0);
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.sku_id === item.id && l.line_type === "product" && !l.epc,
      );
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          cart_id: cryptoId(),
          sku_id: item.id,
          epc: null,
          sku: item.sku ?? null,
          upc: item.upc ?? null,
          description: [item.item_name, item.color, item.size]
            .filter(Boolean)
            .join(" · "),
          quantity: 1,
          unit_price: price,
          discount_amount: 0,
          tax_rate: taxRate,
          line_type: "product",
        },
      ];
    });
  }

  function addRfidItems(items: RfidResolvedItem[]) {
    setLines((prev) => [
      ...prev,
      ...items.map<CartLine>((it) => ({
        cart_id: cryptoId(),
        sku_id: it.sku_id,
        epc: it.epc,
        sku: it.sku,
        upc: it.upc,
        description: [it.item_name, it.color, it.size]
          .filter(Boolean)
          .join(" · "),
        quantity: 1,
        unit_price: Number(it.retail_price ?? 0),
        discount_amount: 0,
        tax_rate: taxRate,
        line_type: "product",
      })),
    ]);
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
      },
    ]);
  }

  function changeQty(cartId: string, next: number) {
    setLines((prev) =>
      prev.map((l) => (l.cart_id === cartId ? { ...l, quantity: next } : l)),
    );
  }

  function removeLine(cartId: string) {
    setLines((prev) => prev.filter((l) => l.cart_id !== cartId));
  }

  function applyLineDiscount(cartId: string, value: number, isPercent: boolean) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.cart_id !== cartId) return l;
        const subtotal = l.unit_price * l.quantity;
        const discount = isPercent
          ? Math.min(subtotal, subtotal * (value / 100))
          : Math.min(subtotal, value);
        return { ...l, discount_amount: Math.max(0, discount) };
      }),
    );
  }

  function applySaleDiscount(value: number, isPercent: boolean) {
    setLines((prev) => {
      const subtotal = prev.reduce(
        (s, l) => s + l.unit_price * l.quantity,
        0,
      );
      if (subtotal <= 0) return prev;
      const total = isPercent
        ? subtotal * (value / 100)
        : Math.min(subtotal, value);
      return prev.map((l) => {
        const lineSubtotal = l.unit_price * l.quantity;
        const share = subtotal > 0 ? lineSubtotal / subtotal : 0;
        return { ...l, discount_amount: Math.max(0, total * share) };
      });
    });
  }

  function startCheckout(method: "card" | "cash" | "other") {
    if (lines.length === 0) return;
    const cart = encodeURIComponent(
      JSON.stringify({
        lines,
        totals,
        customerName: customer?.name ?? null,
        customerId: customer?.id ?? null,
        taxRate,
      }),
    );
    router.push(`/sales/${code}/payment?method=${method}&cart=${cart}`);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col space-y-6">
      {/* "Hello, Elior" — appears when a customer is attached and we have
          at least one item in cart. Sits above the cart per design. */}
      {customer && lines.length > 0 && (
        <div className="text-2xl font-semibold text-carbon-text">
          Hello {customer.name.split(" ")[0]},
        </div>
      )}


      {/* Main POS area */}
      <div className="flex flex-1 gap-6 min-h-0 flex-col xl:flex-row">
        {/* Left column — search + cart + bottom actions */}
        <div className="flex-1 flex flex-col space-y-4 min-w-0">
          <div className="flex gap-4">
            <div className="flex-1">
              <ItemSearch onPick={addProduct} />
            </div>
            <button
              onClick={() => {
                markActivity();
                if (readerState === "off") void startReader();
                setShowRfid(true);
              }}
              className="carbon-btn-secondary tap-lg px-6 font-semibold whitespace-nowrap"
            >
              Scan RFID
            </button>
          </div>

          <CartPanel
            lines={lines}
            onChangeQty={changeQty}
            onRemove={removeLine}
            onEditDiscount={(id) => setDiscountFor(id)}
          />

          <div className="flex gap-4 pt-2">
            <button
              onClick={() => setShowMisc(true)}
              className="flex-1 carbon-btn-secondary tap font-semibold inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                add_circle
              </span>
              Misc Charge
            </button>
            <button
              disabled={lines.length === 0}
              className="flex-1 carbon-btn-secondary tap font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
              title="Phase 2"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                pause_circle
              </span>
              Hold Sale
            </button>
            <button
              onClick={() => setLines([])}
              disabled={lines.length === 0}
              className="flex-1 tap font-semibold border border-red-200 text-carbon-danger bg-white hover:bg-red-50 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                cancel
              </span>
              Clear All
            </button>
          </div>
        </div>

        {/* Right column — checkout */}
        <div className="xl:w-[420px] flex-shrink-0">
          <TotalPanel
            totals={totals}
            customer={customer}
            loyaltyBalance={loyaltyBalance}
            onPickCustomer={setCustomer}
            onClearCustomer={() => setCustomer(null)}
            onNewCustomer={() => {
              // Round-trip: cart + customer are already persisted to LS.
              // CustomerForm appends ?customer_id&customer_name on its
              // post-create redirect when ?next= is present.
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
            nameDrawerOpen={nameDrawerOpen}
            nameSendingToReader={nameSendingToReader}
            phonePromptCollecting={
              phonePromptStatus === "collecting" ||
              phonePromptStatus === "looking-up"
            }
            onChangePendingFirstName={setPendingFirstName}
            onChangePendingLastName={setPendingLastName}
            onToggleNameDrawer={() => setNameDrawerOpen((v) => !v)}
            onSendNameToReader={sendNameToReader}
            onConfirmCreateCustomer={confirmCreateCustomer}
            onCancelPendingPhone={cancelPendingPhone}
            onCancelPhonePrompt={cancelPhonePrompt}
          />
          {customer && loyaltyBalance !== null ? (
            <RedeemPointsModal
              open={showRedeem}
              customer={{ name: customer.name }}
              balance={loyaltyBalance}
              subtotal={totals.subtotal}
              redeemPointsPerDollar={redeemSettings.redeemPointsPerDollar}
              redeemIncrement={redeemSettings.redeemIncrement}
              minRedeemPoints={redeemSettings.minRedeemPoints}
              maxPctOfOrder={redeemSettings.maxPctOfOrder}
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
        readerState={readerState}
        onToggleReader={() => {
          if (readerState === "on") void stopReader();
          else if (readerState === "off") void startReader();
        }}
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
      {discountFor && (
        <DiscountModal
          target={discountFor}
          onCancel={() => setDiscountFor(null)}
          onApply={(value, isPercent) => {
            if (discountFor === "sale") applySaleDiscount(value, isPercent);
            else applyLineDiscount(discountFor, value, isPercent);
            setDiscountFor(null);
          }}
        />
      )}
    </div>
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

function DiscountModal({
  target,
  onCancel,
  onApply,
}: {
  target: string | "sale";
  onCancel: () => void;
  onApply: (value: number, isPercent: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"percent" | "fixed">("percent");
  return (
    <BasicModal
      title={target === "sale" ? "Discount the whole sale" : "Discount line"}
      onCancel={onCancel}
    >
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          onClick={() => setMode("percent")}
          className={`tap border ${
            mode === "percent"
              ? "carbon-btn-primary"
              : "border-[var(--color-pos-border)]"
          }`}
        >
          % Off
        </button>
        <button
          onClick={() => setMode("fixed")}
          className={`tap border ${
            mode === "fixed"
              ? "carbon-btn-primary"
              : "border-[var(--color-pos-border)]"
          }`}
        >
          $ Off
        </button>
      </div>
      <input
        autoFocus
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={mode === "percent" ? "10" : "5.00"}
        className="tap-lg w-full border border-[var(--color-pos-border)] px-3 text-3xl font-semibold mt-3"
      />
      {mode === "percent" && Number(value) > 20 && (
        <p className="text-xs text-amber-700 mt-2">
          Discounts over 20% need a manager PIN. (Phase 2 enforces this.)
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
            if (!Number.isFinite(n) || n <= 0) return;
            onApply(n, mode === "percent");
          }}
          className="tap carbon-btn-primary flex-1 font-semibold"
        >
          Apply
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

