import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed proof that a manager approved a large discount on this
 * terminal (POST /api/pos/auth/manager-approve). Carried on the cart line
 * and verified by the capture route. Bound to the store; valid 8 hours so
 * a cart can sit a while before payment.
 */
function secret(): string {
  return (
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.SESSION_SECRET ||
    ""
  ).trim();
}

export type ApprovalPayload = { eid: number; name: string; lid: string; exp: number };

export function signApproval(p: Omit<ApprovalPayload, "exp">, ttlMs = 8 * 3600_000): string {
  const body = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + ttlMs })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret()).update(`approval.${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyApproval(token: string | null | undefined, lid: string): ApprovalPayload | null {
  if (!token || !secret()) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(`approval.${body}`).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as ApprovalPayload;
    if (p.exp < Date.now() || p.lid !== lid) return null;
    return p;
  } catch {
    return null;
  }
}
