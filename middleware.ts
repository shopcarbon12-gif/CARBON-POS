import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

/**
 * Edge-runtime middleware. Uses the minimal authConfig (no providers) so
 * the Edge bundle stays free of bcrypt + pg. Session validation happens
 * via JWT decoding only here; sign-in itself runs on the Node handler.
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const isPos = nextUrl.pathname.startsWith("/pos");
  const isAdmin = nextUrl.pathname.startsWith("/admin");
  if (!isPos && !isAdmin) return NextResponse.next();
  if (!session) {
    const signIn = new URL("/sign-in", nextUrl);
    signIn.searchParams.set("from", nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }
  if (isAdmin) {
    const role = session.user?.role;
    if (role !== "manager" && role !== "admin") {
      return NextResponse.redirect(new URL("/pos", nextUrl));
    }
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/pos/:path*", "/admin/:path*"],
};
