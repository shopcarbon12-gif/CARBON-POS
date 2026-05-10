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
      // the active location without forcing a re-auth. Only `lid` /
      // `lcode` are mutable; everything else is fixed at sign-in.
      if (trigger === "update" && session && typeof session === "object") {
        const upd = session as { user?: { lid?: unknown; lcode?: unknown } };
        const u = upd.user;
        if (u && typeof u.lid === "string" && u.lid)     token.lid   = u.lid;
        if (u && typeof u.lcode === "string" && u.lcode) token.lcode = u.lcode;
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
