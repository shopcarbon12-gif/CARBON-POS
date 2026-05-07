import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authConfig } from "./auth.config";

/**
 * Two-step sign-in:
 *   1. The sign-in page calls POST /api/auth/locations-for-email with the
 *      location email + password. That endpoint returns the list of
 *      locations the credentials grant access to.
 *   2. The user picks a location (auto-picked if there's only one) and
 *      types their 4-digit PIN. The page then calls signIn("pin", { ... })
 *      with all four fields and this provider re-verifies them all in one
 *      pass before issuing a session.
 *
 * The session JWT carries `lid` (location_id) and `lcode` (location code)
 * so all per-location scoping (URL paths, dashboard data, etc.) keys off
 * the cookie automatically.
 */
const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
  locationId: z.string().uuid(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "pin",
      name: "Carbon POS",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        pin: { label: "PIN", type: "password" },
        locationId: { label: "Location", type: "text" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, pin, locationId } = parsed.data;
        const pool = getPool();

        // Step 1 — re-verify the location credentials. The locations-for-email
        // endpoint already did this in stage 1 of the sign-in screen, but we
        // never trust the client to have done it.
        const loc = await pool.query<{
          id: string;
          code: string;
          name: string;
          password_hash: string;
          tenant_id: string;
        }>(
          `SELECT id::text, code, name, password_hash, tenant_id::text
             FROM locations
            WHERE id = $1::uuid
              AND lower(email) = lower($2)
              AND password_hash IS NOT NULL
              AND is_active = TRUE
            LIMIT 1`,
          [locationId, email],
        );
        const locRow = loc.rows[0];
        if (!locRow) return null;
        if (!(await bcrypt.compare(password, locRow.password_hash))) return null;

        // Step 2 — PIN against active pos_employees rows for users assigned
        // to this location. PIN is one-way so we have to bcrypt.compare each
        // candidate; the candidate set is already narrowed by location and
        // is_active = TRUE so it's bounded.
        const pe = await pool.query<{
          employee_id: number;
          user_id: string;
          role: string;
          pin_hash: string;
          email: string;
        }>(
          `SELECT pe.id   AS employee_id,
                  pe.user_id::text,
                  pe.role,
                  pe.pin_hash,
                  u.email
             FROM pos_employees pe
             JOIN users u ON u.id = pe.user_id
             JOIN user_locations ul ON ul.user_id = pe.user_id
            WHERE pe.is_active = TRUE
              AND ul.location_id = $1::uuid`,
          [locRow.id],
        );
        for (const row of pe.rows) {
          if (await bcrypt.compare(pin, row.pin_hash)) {
            return {
              id: String(row.user_id),
              email: row.email,
              role: row.role,
              employee_id: row.employee_id,
              lid: locRow.id,
              lcode: locRow.code,
              flow: "pin",
            };
          }
        }

        // Bootstrap fallback. Mirrors the old password-provider's behavior
        // so a brand-new tenant can stand up its first cashier without
        // hand-running SQL: when no pos_employees row exists at all in the
        // system AND a WMS user with this email exists, we promote that
        // user to POS admin with the entered PIN, attach them to the
        // chosen location, and complete the sign-in.
        const empty = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM pos_employees`,
        );
        if (empty.rows[0]?.n === 0) {
          const u = await pool.query<{ id: string }>(
            `SELECT id::text FROM users
              WHERE lower(email) = lower($1)
              LIMIT 1`,
            [email],
          );
          const seedUserId = u.rows[0]?.id;
          if (seedUserId) {
            const pinHash = await bcrypt.hash(pin, 10);
            const ins = await pool.query<{ id: number; role: string }>(
              `INSERT INTO pos_employees (user_id, pin_hash, role, is_active)
               VALUES ($1::uuid, $2, 'admin', TRUE)
               RETURNING id, role`,
              [seedUserId, pinHash],
            );
            await pool.query(
              `INSERT INTO user_locations (user_id, location_id)
               VALUES ($1::uuid, $2::uuid)
               ON CONFLICT DO NOTHING`,
              [seedUserId, locRow.id],
            );
            return {
              id: seedUserId,
              email,
              role: ins.rows[0].role,
              employee_id: ins.rows[0].id,
              lid: locRow.id,
              lcode: locRow.code,
              flow: "pin",
            };
          }
        }

        return null;
      },
    }),
  ],
});

export type SessionRole = "cashier" | "supervisor" | "manager" | "admin";
