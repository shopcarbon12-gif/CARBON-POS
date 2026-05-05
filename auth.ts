import NextAuth, { type NextAuthConfig, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getPool } from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "cashier" | "supervisor" | "manager" | "admin";
      employee_id: number;
      flow: "pin" | "password";
    } & DefaultSession["user"];
  }
}

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
});

const passwordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Two providers:
 *  - "pin": for the touch register screen. Cashier enters their 4-digit PIN.
 *           We bcrypt-compare against every active pos_employees.pin_hash.
 *           Tradeoff: 4-digit PIN means we must check all candidates because
 *           bcrypt is one-way. Active employee count is small (tens), so this
 *           is fine.
 *  - "password": for back-office /admin. Email + password against WMS users.
 *                Falls back to pos_employees PIN-as-password if you want a
 *                separate admin password column, add it later.
 */
const config: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/sign-in" },
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
        // Only managers and admins are allowed in the back-office.
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
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.employee_id = (user as { employee_id: number }).employee_id;
        token.flow = (user as { flow: "pin" | "password" }).flow;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.sub ?? "");
        session.user.role = (token.role ?? "cashier") as
          | "cashier"
          | "supervisor"
          | "manager"
          | "admin";
        session.user.employee_id = Number(token.employee_id ?? 0);
        session.user.flow = (token.flow ?? "pin") as "pin" | "password";
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

export type SessionRole = "cashier" | "supervisor" | "manager" | "admin";
