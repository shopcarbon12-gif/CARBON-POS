import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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
  return NextResponse.json({ locations: matched });
}
