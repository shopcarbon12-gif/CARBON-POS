import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Admin-approved overrides (see migrations/027). The approval — an admin
 * PIN or an emailed one-time code — mints a signed token bound to the
 * store, the kind and a reference (SKU id or original sale id). The cart
 * carries it; the capture / refund routes verify it.
 */

export const OVERRIDE_KINDS = ["rfid_sale", "rfid_return", "exchange_payout"] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

export const OVERRIDE_LABEL: Record<OverrideKind, string> = {
  rfid_sale: "Sell an RFID item without scanning its tag",
  rfid_return: "Return an RFID item without scanning its tag",
  exchange_payout: "Pay an exchange difference back to the original payment (not store credit)",
};

/** Who receives emailed approval codes. */
export function overrideApproverEmail(): string {
  return (
    process.env.OVERRIDE_APPROVER_EMAIL ||
    process.env.STORE_CREDIT_APPROVER_EMAIL ||
    "elior@carbonjeanscompany.com"
  )
    .trim()
    .toLowerCase();
}

function secret(): string {
  return (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.SESSION_SECRET || "").trim();
}

export function hashOverrideCode(code: string, kind: string, ref: string): string {
  return createHash("sha256").update(`${code}|${kind}|${ref}`).digest("hex");
}

type Payload = { k: OverrideKind; ref: string; lid: string; by: string; exp: number };

/** Valid 30 minutes — enough to finish the sale it was approved for. */
export function signOverride(p: { kind: OverrideKind; ref: string; lid: string; by: string }): string {
  const body = Buffer.from(
    JSON.stringify({ k: p.kind, ref: p.ref, lid: p.lid, by: p.by, exp: Date.now() + 30 * 60_000 }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(`override.${body}`).digest("base64url");
  return `${body}.${sig}`;
}

/** The approver's name when the token is valid for (kind, ref) here. */
export function verifyOverride(
  token: string | null | undefined,
  kind: OverrideKind,
  ref: string,
  lid: string,
): string | null {
  if (!token || !secret()) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(`override.${body}`).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (p.k !== kind || p.ref !== ref || p.lid !== lid || p.exp < Date.now()) return null;
    return p.by;
  } catch {
    return null;
  }
}
