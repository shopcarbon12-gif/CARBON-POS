import { NextResponse } from "next/server";
import { z } from "zod";
import { currentCashier } from "@/lib/session";
import { posReaderForCurrentSession } from "@/lib/reader-control";

export const runtime = "nodejs";

const schema = z.object({
  kind: z.enum(["new_customer"]),
  dwell_ms: z.number().int().min(1000).max(20000).optional().default(7000),
});

/**
 * POST /api/pos/hardware/reader/welcome
 *
 * Swap the account-default Terminal Configuration's splashscreen to a
 * branded "thank you for joining" image, force the reader back to idle
 * via cancel_action, then schedule a server-side revert after dwell_ms
 * so the default Carbon splash returns.
 *
 * No client involvement for the revert — the setTimeout runs in the
 * Next.js Node process and is independent of the cashier's tab. If the
 * process restarts mid-window the welcome image stays until the next
 * swap (a known and accepted tradeoff for a 7 s effect).
 *
 * The image surface is the ONLY clean-text screen the BBPOS WisePOS E
 * exposes via Stripe Terminal — set_reader_display always renders cart
 * chrome (line items, total, "tap or insert your card" footer). So we
 * use the splash override instead.
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
  const res = await stripe(`/v1/terminal/configurations/${CONFIG_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `bbpos_wisepos_e[splashscreen]=${encodeURIComponent(fileId)}`,
  });
  return res.ok;
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
  const info = await posReaderForCurrentSession(cashier.user_id);
  if (!info) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_reader" });
  }

  // 1. Swap config splashscreen → welcome image. Stripe propagates to
  //    the reader on its next config poll (typically <5 s).
  const swapped = await setSplashTo(NEW_CUSTOMER_SPLASH_FILE);
  if (!swapped) {
    return NextResponse.json({ error: "swap_failed" }, { status: 502 });
  }

  // 2. cancel_action so any in-flight Stripe action ends and the reader
  //    transitions to idle — where it'll pick up the new splash.
  await stripe(`/v1/terminal/readers/${info.reader_id}/cancel_action`, {
    method: "POST",
    body: "",
  }).catch(() => {});

  // 3. Schedule the revert. Runs in the Node event loop, survives the
  //    HTTP response returning. We don't await this — the cashier flow
  //    doesn't need to wait 7 s.
  setTimeout(async () => {
    try {
      await setSplashTo(DEFAULT_SPLASH_FILE);
    } catch {
      /* best-effort */
    }
  }, parsed.data.dwell_ms);

  return NextResponse.json({
    ok: true,
    splash_file_id: NEW_CUSTOMER_SPLASH_FILE,
    reverts_in_ms: parsed.data.dwell_ms,
  });
}
