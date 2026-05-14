import { NextResponse } from "next/server";
import { z } from "zod";
import { currentCashier } from "@/lib/session";
import { posReaderForCurrentSession } from "@/lib/reader-control";

export const runtime = "nodejs";

const schema = z.object({
  kind: z.enum(["preload", "new_customer", "revert"]),
  dwell_ms: z.number().int().min(1000).max(20000).optional().default(7000),
});

/**
 * POST /api/pos/hardware/reader/welcome
 *
 * Swap the account-default Terminal Configuration's splashscreen to a
 * branded "thank you for joining" image. The image surface is the ONLY
 * clean-text screen the BBPOS WisePOS E exposes — set_reader_display
 * always renders cart chrome — so we use the splash override.
 *
 * Stripe propagates config changes to the reader on its next config
 * poll/push, which can take 5–30 s. To make the splash actually visible
 * during the post-prompt transition, the frontend calls this endpoint
 * in two steps:
 *
 *   1. `preload` — fired as soon as the cashier starts the phone
 *      prompt. The customer is still typing (5–30 s typical), and the
 *      reader is showing collect_inputs UI — the splash isn't visible
 *      yet. Plenty of time for Stripe to push the new config to the
 *      reader before the collect_inputs ends.
 *
 *   2. After the phone result is known:
 *        new_customer → schedule the revert after dwell_ms (default 7 s)
 *        revert       → swap back to DEFAULT immediately (existing
 *                        customer, customer cancelled, or cashier
 *                        cancelled — we don't want the next interaction
 *                        to inherit the new-customer splash)
 *
 * The setTimeout for `new_customer` runs in the Node event loop and
 * survives the HTTP response returning. We don't await it — the cashier
 * flow doesn't need to wait 7 s.
 */
const DEFAULT_SPLASH_FILE =
  process.env.STRIPE_TERMINAL_DEFAULT_SPLASH_FILE?.trim()
  || "file_1TWNS3BeOBuiDwofNDj6AiNJ";
const NEW_CUSTOMER_SPLASH_FILE =
  process.env.STRIPE_TERMINAL_NEW_CUSTOMER_SPLASH_FILE?.trim()
  || "file_1TWnMwBeOBuiDwoff5XS7XKx";
const CONFIG_ID =
  process.env.STRIPE_TERMINAL_CONFIG_ID?.trim()
  || "tmc_61Ufk87uLSUEAnP5I41BeOBuiDwof8cC";

async function stripe(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  return fetch(`https://api.stripe.com${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      ...(init.headers ?? {}),
    },
  });
}

async function setSplashTo(fileId: string): Promise<boolean> {
  try {
    const res = await stripe(`/v1/terminal/configurations/${CONFIG_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `bbpos_wisepos_e[splashscreen]=${encodeURIComponent(fileId)}`,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error(`[welcome] setSplashTo(${fileId}) failed:`, res.status, body);
    }
    return res.ok;
  } catch (err) {
    console.error(`[welcome] setSplashTo(${fileId}) threw:`, err);
    return false;
  }
}

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  // The session check ensures we don't trigger swaps from random callers
  // but the swap itself targets the account-wide config — no reader_id
  // needed for the Stripe call.
  const info = await posReaderForCurrentSession(cashier.user_id);
  if (!info) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_reader" });
  }

  const { kind, dwell_ms } = parsed.data;

  if (kind === "preload") {
    // Front-load the swap so Stripe has time to propagate before the
    // splash becomes visible. No revert here — the caller will follow
    // up with `new_customer` or `revert` once the lookup completes.
    const ok = await setSplashTo(NEW_CUSTOMER_SPLASH_FILE);
    return NextResponse.json({
      ok,
      splash_file_id: NEW_CUSTOMER_SPLASH_FILE,
    });
  }

  if (kind === "revert") {
    const ok = await setSplashTo(DEFAULT_SPLASH_FILE);
    return NextResponse.json({
      ok,
      splash_file_id: DEFAULT_SPLASH_FILE,
    });
  }

  // kind === "new_customer" — defensively set to NEW (no-op if preload
  // already did), then schedule the revert + a real-time display kick.
  const swapped = await setSplashTo(NEW_CUSTOMER_SPLASH_FILE);
  if (!swapped) {
    return NextResponse.json({ error: "swap_failed" }, { status: 502 });
  }
  const readerId = info.reader_id;
  setTimeout(async () => {
    try {
      // 1. Flip the account-default splash back. New idle transitions
      //    will pull the default Carbon splash from now on.
      await setSplashTo(DEFAULT_SPLASH_FILE);
      // 2. The READER has the welcome PNG cached locally and won't
      //    refresh its idle splash until its next config pull (often
      //    30 s+). Without a kick, the welcome image lingers past the
      //    7-second dwell. Push a real-time empty cart_display so the
      //    reader leaves the splash surface immediately; the cashier's
      //    next sale action (adding a line, collecting payment) will
      //    overwrite this, and the next return-to-idle will load the
      //    default splash that's now in config.
      await pushPlaceholderCart(readerId);
    } catch {
      /* best-effort */
    }
  }, dwell_ms);

  return NextResponse.json({
    ok: true,
    splash_file_id: NEW_CUSTOMER_SPLASH_FILE,
    reverts_in_ms: dwell_ms,
  });
}

/**
 * Forces the reader off the welcome splash by canceling any lingering
 * action and pushing a placeholder cart_display.
 *
 *   1. Fetch the reader's current action. Skip the kick ONLY if a
 *      collect_inputs / payment is genuinely in_progress (cashier was
 *      quick during the 7-second dwell). A "succeeded" action from
 *      the just-finished phone prompt is NOT a reason to skip — at
 *      that point the reader is sitting on the splash showing the
 *      welcome PNG, and we need to push it off.
 *
 *   2. cancel_action to clear any stale succeeded/failed action so the
 *      reader is squarely idle before we push a new display state.
 *
 *   3. set_reader_display with a one-line cart. Amount is 1 cent (not
 *      0) so it's unambiguous — some Stripe Terminal display rules
 *      treat 0-total carts as empty/no-op. The cashier's next sale
 *      line, payment, or collect_inputs will overwrite this.
 *
 * Logs failures to the server console (no silent .catch) so we can
 * actually see WHY the kick didn't land when the JPG sticks.
 */
async function pushPlaceholderCart(readerId: string): Promise<void> {
  // Step 1 — inspect current action.
  let actionInProgress = false;
  try {
    const r = await stripe(`/v1/terminal/readers/${readerId}`);
    if (r.ok) {
      const reader = await r.json();
      actionInProgress = reader.action?.status === "in_progress";
    }
  } catch (err) {
    console.error("[welcome] reader fetch failed:", err);
  }
  if (actionInProgress) {
    console.log("[welcome] skipping cart push — action in_progress");
    return;
  }

  // Step 2 — best-effort cancel of any non-in_progress lingering action.
  try {
    const cancel = await stripe(`/v1/terminal/readers/${readerId}/cancel_action`, {
      method: "POST",
      body: "",
    });
    if (!cancel.ok) {
      const j = await cancel.json().catch(() => ({}));
      // "no_action" is fine — reader was already idle.
      if (j.error?.code !== "no_action") {
        console.log("[welcome] cancel_action non-ok:", cancel.status, j.error?.code);
      }
    }
  } catch (err) {
    console.error("[welcome] cancel_action threw:", err);
  }

  // Step 3 — push the cart display.
  const form = new URLSearchParams({
    type: "cart",
    "cart[currency]": "usd",
    "cart[total]": "1",
    "cart[line_items][0][description]": "Welcome to Carbon",
    "cart[line_items][0][amount]": "1",
    "cart[line_items][0][quantity]": "1",
  });
  try {
    const res = await stripe(`/v1/terminal/readers/${readerId}/set_reader_display`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error("[welcome] set_reader_display failed:", res.status, body);
    } else {
      console.log("[welcome] set_reader_display ok");
    }
  } catch (err) {
    console.error("[welcome] set_reader_display threw:", err);
  }
}
