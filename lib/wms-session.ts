import { SignJWT } from "jose";

/**
 * Mint a short-lived WMS-format session JWT for the current cashier.
 *
 * WMS's getSessionFromRequest accepts `Authorization: Bearer <jwt>` (see
 * carbon-warehouse-management/lib/auth.ts). The JWT is HS256-signed with
 * SESSION_SECRET — a value POS and WMS share via Coolify env. The payload
 * shape mirrors WMS exactly: sub + tid + lid + email + role.
 *
 * Used by the RFID SSE proxy so the POS server can subscribe to WMS's
 * /api/edge/stream as the signed-in cashier without ever exposing the JWT
 * to the browser.
 */
export async function mintWmsSessionJwt(p: {
  user_id: string;
  email: string | null;
  tid: string;
  lid: string;
  role: string;
}): Promise<string> {
  const raw = process.env.SESSION_SECRET?.trim();
  if (!raw) {
    throw new Error(
      "SESSION_SECRET is not set on the POS server — required to sign WMS-format JWTs.",
    );
  }
  if (!p.tid || !p.lid || !p.email) {
    throw new Error(
      "Cannot mint WMS JWT: cashier session is missing tid/lid/email.",
    );
  }
  const secret = new TextEncoder().encode(raw);
  return new SignJWT({
    tid: p.tid,
    lid: p.lid,
    email: p.email,
    role: p.role || "member",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.user_id)
    .setExpirationTime("15m")
    .sign(secret);
}
