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
        const result = await pool.query(
          `SELECT u.id          AS user_id,
                  u.email,
                  u.password_hash,
                  pe.id          AS employee_id,
                  pe.role
             FROM users u
        LEFT JOIN pos_employees pe ON pe.user_id = u.id AND pe.is_active = TRUE
            WHERE lower(u.email) = lower($1)
            LIMIT 1`,
          [email],
        );
        const row = result.rows[0];
        if (!row || !row.password_hash) return null;
        if (!(await bcrypt.compare(password, row.password_hash))) return null;
        const role = row.role ?? "cashier";
        if (role !== "manager" && role !== "admin") return null;
        return {
          id: String(row.user_id),
          email: row.email,
          role,
          employee_id: row.employee_id,
          flow: "password",
        };
      },
    }),
  ],
});

export type SessionRole = "cashier" | "supervisor" | "manager" | "admin";
