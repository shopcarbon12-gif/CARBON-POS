import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Resolve the Stripe Terminal reader id (tmr_XXX) for the cashier's
 * open register session. CRITICAL: this is the Stripe-side id, not the
 * WMS/CDM devices.id (which is the RFID reader, a totally different
 * device). cancel_action and set_reader_display both expect tmr_XXX —
 * passing the CDM UUID returns 400 "Invalid param: id" and the kick
 * silently fails, leaving the welcome JPG stranded on the splash past
 * the 7-second dwell.
 */
async function stripeReaderIdForCashier(userId: string): Promise<string | null> {
  const r = await getPool().query<{ stripe_reader_id: string | null }>(
    `SELECT reg.stripe_reader_id
       FROM pos_register_sessions s
       JOIN pos_registers reg ON reg.id = s.register_id
      WHERE s.status = 'open' AND s.opened_by = $1
      ORDER BY s.opened_at DESC LIMIT 1`,
    [userId],
  );
  return r.rows[0]?.stripe_reader_id ?? null;
}

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
  // Two reader-ish things are at play here and they are NOT the same:
  //   - The CDM/WMS RFID reader (devices.id, a UUID) — used by
  //     /api/pos/hardware/reader/{start,stop,state}. NOT what Stripe
  //     Terminal wants.
  //   - The Stripe Terminal reader (pos_registers.stripe_reader_id,
  //     a tmr_XXX id) — what cancel_action and set_reader_display
  //     expect on the kick step at the end of the 7-second dwell.
  // We resolve the second one. setSplashTo() hits the account-wide
  // Configuration object and does NOT need any reader id, so it
  // works even when no terminal is paired to this register.
  const readerId = await stripeReaderIdForCashier(cashier.user_id);
  if (!readerId) {
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
  setTimeout(async () => {
    try {
      // 1. Flip the account-default splash back so future idle
      //    transitions pull DEFAULT instead of NEW. This is enough on
      //    its own — we no longer push a placeholder cart, which the
      //    operator was rightly hating: it rendered visibly as
      //    "Welcome to Carbon  $0.01" because Stripe Terminal renders
      //    every line item regardless of zero/one-cent amounts.
      // 2. cancel_action best-effort to clear the just-finished phone
      //    collect_inputs action object so the reader sits cleanly on
      //    splash. If the reader hasn't pulled the DEFAULT config yet
      //    the welcome JPG may linger a few extra seconds before the
      //    next config poll — strictly better than the $0.01 cart.
      await setSplashTo(DEFAULT_SPLASH_FILE);
      await stripe(`/v1/terminal/readers/${readerId}/cancel_action`, {
        method: "POST",
        body: "",
      }).then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          if (j.error?.code !== "no_action") {
            console.log("[welcome] cancel_action non-ok:", r.status, j.error?.code);
          }
        }
      }).catch((err) => console.error("[welcome] cancel_action threw:", err));
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

