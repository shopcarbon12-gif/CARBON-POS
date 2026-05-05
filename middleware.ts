import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Protect everything under /pos and /admin. Unauthenticated users get
 * bounced to /sign-in. The /api/health endpoint stays open for Coolify.
 */
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
