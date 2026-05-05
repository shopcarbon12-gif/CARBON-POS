import type { NextAuthConfig, DefaultSession } from "next-auth";

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

/**
 * Edge-safe NextAuth config — used by middleware.ts. NO providers here
 * (credentials uses bcrypt + pg which require Node's `crypto` and break in
 * the Edge runtime). The full config in auth.ts spreads this and adds the
 * credentials providers for the actual /api/auth handler.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/sign-in" },
  providers: [],
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
