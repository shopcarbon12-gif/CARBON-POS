import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { authConfig } from "./auth.config";

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
});

const passwordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Full NextAuth config — runs only in /api/auth/[...nextauth]/route.ts (Node
 * runtime). The middleware uses authConfig directly so the Edge bundle
 * doesn't pull in bcrypt + pg.
 *
 * Two providers:
 *  - "pin": touch register. Cashier enters their 4-digit PIN; we
 *    bcrypt-compare against every active pos_employees.pin_hash. PIN is
 *    one-way so the loop is required; active employee count is small.
 *  - "password": back office. Email + password against WMS users.
 *    Restricted to manager + admin roles.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "pin",
      name: "Register PIN",
      credentials: {
        pin: { label: "PIN", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = pinSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { pin } = parsed.data;
        const pool = getPool();
        const result = await pool.query(
          `SELECT pe.id        AS employee_id,
                  pe.user_id,
                  pe.role,
                  pe.pin_hash,
                  u.email
             FROM pos_employees pe
             JOIN users u ON u.id = pe.user_id
            WHERE pe.is_active = TRUE`,
        );
        for (const row of result.rows) {
          if (await bcrypt.compare(pin, row.pin_hash)) {
            return {
              id: String(row.user_id),
              email: row.email,
              role: row.role,
              employee_id: row.employee_id,
              flow: "pin",
            };
          }
        }
        return null;
      },
    }),
    Credentials({
      id: "password",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = passwordSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const pool = getPool();
        // Prefer pos_employees.pos_password_hash (added by WMS migration 0058
        // — POS-only password, independent of users.password_hash). Fall back
        // to users.password_hash when the POS-specific hash hasn't been set
        // (legacy rows + bootstrap path). The column may not exist on older
        // DBs that haven't run 0058 yet, so we probe information_schema first
        // and pick the SELECT shape accordingly.
        const colCheck = await pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'pos_employees' AND column_name = 'pos_password_hash'
           ) AS exists`,
        );
        const hasPosPwd = !!colCheck.rows[0]?.exists;
        const posPwdSelect = hasPosPwd ? "pe.pos_password_hash" : "NULL::text AS pos_password_hash";
        const result = await pool.query(
          `SELECT u.id          AS user_id,
                  u.email,
                  u.password_hash,
                  ${posPwdSelect},
                  pe.id          AS employee_id,
                  pe.role
             FROM users u
        LEFT JOIN pos_employees pe ON pe.user_id = u.id AND pe.is_active = TRUE
            WHERE lower(u.email) = lower($1)
            LIMIT 1`,
          [email],
        );
        const row = result.rows[0];
        if (!row) return null;
        const hashToCheck = row.pos_password_hash || row.password_hash;
        if (!hashToCheck) return null;
        if (!(await bcrypt.compare(password, hashToCheck))) return null;

        // Bootstrap path: if there are zero pos_employees in the system, the
        // very first WMS user that signs in here gets auto-promoted to admin
        // with a default PIN of 0000. The /admin/employees screen warns them
        // to change it. This is the only way to onboard the first manager
        // without hand-running SQL.
        let role = row.role ?? null;
        let employee_id = row.employee_id ?? null;
        if (!employee_id) {
          const count = await pool.query(
            `SELECT COUNT(*)::int AS n FROM pos_employees`,
          );
          if (count.rows[0].n === 0) {
            const defaultPin = process.env.POS_BOOTSTRAP_ADMIN_PIN?.trim() || "1234";
            const defaultPinHash = await bcrypt.hash(defaultPin, 10);
            const ins = await pool.query(
              `INSERT INTO pos_employees (user_id, pin_hash, role, is_active)
               VALUES ($1, $2, 'admin', TRUE)
               RETURNING id, role`,
              [row.user_id, defaultPinHash],
            );
            employee_id = ins.rows[0].id;
            role = ins.rows[0].role;
          }
        }
        if (role !== "manager" && role !== "admin") return null;
        return {
          id: String(row.user_id),
          email: row.email,
          role,
          employee_id,
          flow: "password",
        };
      },
    }),
  ],
});

export type SessionRole = "cashier" | "supervisor" | "manager" | "admin";
