import type { NextAuthConfig, DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "cashier" | "supervisor" | "manager" | "admin";
      employee_id: number;
      /** Tenant id (UUID, text) — needed when minting WMS-format JWTs. */
      tid: string;
      /** Active location id (UUID, text) — set at sign-in time. */
      lid: string;
      /** Active location code (e.g. "003") — used in URL paths. */
      lcode: string;
      flow: "pin" | "password";
    } & DefaultSession["user"];
  }
}

/**
 * Edge-safe NextAuth config — used by middleware.ts. NO providers here
 * (credentials uses bcrypt + pg which require Node's `crypto` and break in
 * the Edge runtime). The full config in auth.ts spreads this and adds the
 * credentials providers for the actual /api/auth handler.
 */
export const authConfig: NextAuthConfig = {
  // Coolify's Traefik fronts the app, so the request hostname inside the
  // container looks like an internal IP, not pos.shopcarbon.com. Auth.js
  // v5 refuses to issue sessions in that case unless we explicitly trust
  // the X-Forwarded-Host header. Without this every /api/auth/session call
  // throws UntrustedHost and the /sign-in page renders "Server error".
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/sign-in" },
  providers: [],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.employee_id = (user as { employee_id: number }).employee_id;
        token.tid = (user as { tid: string }).tid;
        token.lid = (user as { lid: string }).lid;
        token.lcode = (user as { lcode: string }).lcode;
        token.flow = (user as { flow: "pin" | "password" }).flow;
      }
      // Session update trigger — used by the location switcher to swap
      // the active location without forcing a re-auth. The new location is
      // re-validated against user_locations + tenant on the server; the client
      // value is NOT trusted (otherwise any user could switch to any store).
      // `lcode`/`tid` are taken authoritatively from the DB, never the client.
      if (trigger === "update" && session && typeof session === "object") {
        const upd = session as { user?: { lid?: unknown } };
        const newLid = upd.user?.lid;
        if (typeof newLid === "string" && newLid && token.sub) {
          // Dynamic import so pg is never bundled into the Edge middleware
          // that also loads this config.
          const { getPool } = await import("@/lib/db");
          const loc = await getPool().query<{ id: string; code: string; tid: string }>(
            `SELECT l.id::text AS id, l.code, l.tenant_id::text AS tid
               FROM locations l
              WHERE l.id = $1::uuid AND l.is_active = TRUE
                AND ( EXISTS (SELECT 1 FROM user_locations ul
                               WHERE ul.user_id = $2::uuid AND ul.location_id = l.id)
                      OR NOT EXISTS (SELECT 1 FROM user_locations ul
                                      WHERE ul.user_id = $2::uuid) )
              LIMIT 1`,
            [newLid, String(token.sub)],
          );
          const lrow = loc.rows[0];
          if (lrow) {
            token.lid = lrow.id;
            token.lcode = lrow.code;
            token.tid = lrow.tid;
          }
          // No matching assigned location → ignore the switch (keep current).
        }
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
        session.user.tid = String(token.tid ?? "");
        session.user.lid = String(token.lid ?? "");
        session.user.lcode = String(token.lcode ?? "");
        session.user.flow = (token.flow ?? "pin") as "pin" | "password";
      }
      return session;
    },
  },
};
