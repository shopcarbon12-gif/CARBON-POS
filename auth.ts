import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authConfig } from "./auth.config";
import { verifySwitchToken, SWITCH_COOKIE } from "@/lib/switch-token";

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

export const { handlers, auth, signIn, signOut, unstable_update: update } = NextAuth({
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
              tid: locRow.tenant_id,
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
              tid: locRow.tenant_id,
              lid: locRow.id,
              lcode: locRow.code,
              flow: "pin",
            };
          }
        }

        return null;
      },
    }),

    // Primary login: employee email + their POS password. Resolves the
    // chosen location (must be one the employee is assigned to) and signs
    // them in directly — no PIN needed.
    Credentials({
      id: "password",
      name: "Carbon POS password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        locationId: { label: "Location", type: "text" },
      },
      authorize: async (raw) => {
        const schema = z.object({
          email: z.string().email(),
          password: z.string().min(1),
          locationId: z.string().uuid(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, locationId } = parsed.data;
        const pool = getPool();
        const emp = await pool.query<{
          employee_id: number;
          user_id: string;
          role: string;
          pos_password_hash: string | null;
          user_password_hash: string | null;
          email: string;
        }>(
          `SELECT pe.id AS employee_id, pe.user_id::text, pe.role,
                  pe.pos_password_hash,
                  u.password_hash AS user_password_hash,
                  u.email
             FROM pos_employees pe
             JOIN users u ON u.id = pe.user_id
            WHERE lower(u.email) = lower($1) AND pe.is_active = TRUE
            LIMIT 1`,
          [email],
        );
        const row = emp.rows[0];
        if (!row) return null;
        const hash = row.pos_password_hash || row.user_password_hash;
        if (!hash || !(await bcrypt.compare(password, hash))) return null;
        const loc = await pool.query<{ id: string; code: string; tid: string }>(
          `SELECT l.id::text, l.code, l.tenant_id::text AS tid
             FROM locations l
            WHERE l.id = $1::uuid AND l.is_active = TRUE
              AND ( EXISTS (SELECT 1 FROM user_locations ul
                             WHERE ul.user_id = $2::uuid AND ul.location_id = l.id)
                    OR NOT EXISTS (SELECT 1 FROM user_locations ul
                                    WHERE ul.user_id = $2::uuid) )
            LIMIT 1`,
          [locationId, row.user_id],
        );
        const lrow = loc.rows[0];
        if (!lrow) return null;
        return {
          id: String(row.user_id),
          email: row.email,
          role: row.role,
          employee_id: row.employee_id,
          tid: lrow.tid,
          lid: lrow.id,
          lcode: lrow.code,
          flow: "password",
        };
      },
    }),

    // "Change employee" switch: consumes the short-lived, HMAC-signed cookie
    // minted by /api/pos/auth/switch-prepare (which itself required a valid
    // session). A PIN can therefore never bypass the password login.
    Credentials({
      id: "switch",
      name: "Carbon POS switch",
      credentials: {},
      authorize: async (_raw, req) => {
        const cookieHeader = req?.headers?.get?.("cookie") ?? "";
        const re = new RegExp(`(?:^|;\\s*)${SWITCH_COOKIE}=([^;]+)`);
        const m = cookieHeader.match(re);
        const token = m ? decodeURIComponent(m[1]) : null;
        const p = verifySwitchToken(token);
        if (!p) return null;
        return {
          id: p.user_id,
          email: p.email,
          role: p.role,
          employee_id: p.employee_id,
          tid: p.tid,
          lid: p.lid,
          lcode: p.lcode,
          flow: "pin",
        };
      },
    }),
  ],
});

export type SessionRole = "cashier" | "supervisor" | "manager" | "admin";
