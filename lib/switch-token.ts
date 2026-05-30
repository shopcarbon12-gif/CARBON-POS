import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, HMAC-signed token for the "Change employee" PIN switch.
 *
 * Flow: a logged-in terminal POSTs a PIN to /api/pos/auth/switch-prepare,
 * which (using the *current* session to prove the terminal is authorized for
 * its location) verifies the PIN against an active employee at that location
 * and mints one of these tokens into an httpOnly cookie. The NextAuth "switch"
 * provider then verifies the token and issues the new employee's session.
 *
 * This means a PIN can never bypass the password login: minting requires an
 * existing valid session, and the token is signed with NEXTAUTH_SECRET.
 */
function secret(): string {
  return (
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.SESSION_SECRET ||
    ""
  ).trim();
}

export type SwitchPayload = {
  user_id: string;
  email: string;
  employee_id: number;
  role: string;
  tid: string;
  lid: string;
  lcode: string;
  exp: number;
};

export const SWITCH_COOKIE = "pos_switch";

export function signSwitchToken(
  p: Omit<SwitchPayload, "exp">,
  ttlMs = 60_000,
): string {
  const payload: SwitchPayload = { ...p, exp: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySwitchToken(
  token: string | undefined | null,
): SwitchPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SwitchPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
