import { auth } from "@/auth";

/**
 * Helper for API routes / server components that require an authenticated
 * cashier. Returns null when there's no session — the caller decides whether
 * to redirect or 401. `lid` / `lcode` carry the active location chosen at
 * sign-in time so per-location scoping keys off the session cookie.
 */
export async function currentCashier() {
  const session = await auth();
  if (!session?.user?.employee_id) return null;
  return {
    /** WMS users.id is a UUID — string. */
    user_id: String(session.user.id),
    employee_id: session.user.employee_id,
    role: session.user.role,
    email: session.user.email ?? null,
    lid: session.user.lid,
    lcode: session.user.lcode,
    flow: session.user.flow,
  };
}
