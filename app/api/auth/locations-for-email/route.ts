import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// In-memory brute-force throttle for stage 1 of POS sign-in (the location
// email+password check). Keyed by client IP + email; per-instance, resets on
// restart. Location logins are infrequent, so this never trips legit use.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  // Last X-Forwarded-For hop is the one our proxy (Traefik) appends; earlier
  // entries can be spoofed by the client.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
    }
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

/**
 * POST /api/auth/locations-for-email
 *
 * Step 1 of the two-step POS sign-in. The caller submits the location
 * credentials (email + password set in the WMS Locations admin); we return
 * every active location whose `email` matches AND whose `password_hash`
 * verifies against the supplied password.
 *
 * The same email can be assigned to multiple locations — when that happens
 * the sign-in screen shows a location picker before the PIN keypad.
 *
 * Returns 401 if no location matches; never tells the caller which half of
 * the credential was wrong (timing / enumeration safety).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const rlKey = `${clientIp(req)}:${email.toLowerCase()}`;
  if (tooManyAttempts(rlKey)) {
    return NextResponse.json(
      { error: "too_many_attempts", message: "Too many sign-in attempts. Wait a few minutes." },
      { status: 429 },
    );
  }

  const pool = getPool();
  const r = await pool.query<{
    id: string;
    code: string;
    name: string;
    password_hash: string;
  }>(
    `SELECT id::text, code, name, password_hash
       FROM locations
      WHERE lower(email) = lower($1)
        AND password_hash IS NOT NULL
        AND is_active = TRUE
      ORDER BY code ASC`,
    [email],
  );

  const matched: { id: string; code: string; name: string }[] = [];
  for (const row of r.rows) {
    if (await bcrypt.compare(password, row.password_hash)) {
      matched.push({ id: row.id, code: row.code, name: row.name });
    }
  }

  if (matched.length === 0) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  attempts.delete(rlKey); // successful stage-1 clears the throttle
  return NextResponse.json({ locations: matched });
}
