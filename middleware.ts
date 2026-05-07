import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

/**
 * Edge-runtime middleware. Uses the minimal authConfig (no providers) so
 * the Edge bundle stays free of bcrypt + pg. Session validation happens
 * via JWT decoding only here; sign-in itself runs on the Node handler.
 *
 * After the URL restructure, every authenticated page lives under one of
 * the top-level tabs and is suffixed with the active location code:
 *   /dashboard/[code], /sales/[code]/..., /reports/[code]/..., etc.
 *
 * Legacy /admin/* and /pos/* paths are 308-redirected to the equivalent
 * new shape. If we don't know the code (no session), the redirect points
 * at /sign-in.
 */
const { auth } = NextAuth(authConfig);

const PROTECTED_TABS = [
  "/dashboard",
  "/sales",
  "/inventory",
  "/reports",
  "/customers",
  "/employees",
  "/settings",
];

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const path = nextUrl.pathname;

  // Legacy redirects: /admin → /dashboard/{code}, /pos → /sales/{code}/new.
  if (path === "/admin" || path.startsWith("/admin/")) {
    const lcode = (session?.user as { lcode?: string } | undefined)?.lcode;
    if (!lcode) {
      const signIn = new URL("/sign-in", nextUrl);
      signIn.searchParams.set("from", path);
      return NextResponse.redirect(signIn);
    }
    const rest = path.slice("/admin".length); // e.g. "/sales/123" or ""
    const target = rest === "" || rest === "/"
      ? `/dashboard/${lcode}`
      : `/${rest.split("/")[1] ?? "dashboard"}/${lcode}${rest.split("/").slice(2).map((p) => `/${p}`).join("")}`;
    return NextResponse.redirect(new URL(target, nextUrl));
  }
  if (path === "/pos" || path.startsWith("/pos/")) {
    const lcode = (session?.user as { lcode?: string } | undefined)?.lcode;
    if (!lcode) {
      const signIn = new URL("/sign-in", nextUrl);
      signIn.searchParams.set("from", path);
      return NextResponse.redirect(signIn);
    }
    const rest = path.slice("/pos".length);
    const target =
      rest === "" || rest === "/" ? `/sales/${lcode}/new` : `/sales/${lcode}${rest}`;
    return NextResponse.redirect(new URL(target, nextUrl));
  }

  // For the new tabs, just gate on auth. Per-page lcode/role checks live in
  // pageGuard (server component) so we don't duplicate role logic here.
  const isProtected = PROTECTED_TABS.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
  if (!isProtected) return NextResponse.next();
  if (!session) {
    const signIn = new URL("/sign-in", nextUrl);
    signIn.searchParams.set("from", path);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/sales/:path*",
    "/inventory/:path*",
    "/reports/:path*",
    "/customers/:path*",
    "/employees/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/pos/:path*",
  ],
};
