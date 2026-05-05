import { auth } from "@/auth";

/**
 * Helper for API routes / server components that require an authenticated
 * cashier. Returns null when there's no session — the caller decides whether
 * to redirect or 401.
 */
export async function currentCashier() {
  const session = await auth();
  if (!session?.user?.employee_id) return null;
  return {
    user_id: Number(session.user.id),
    employee_id: session.user.employee_id,
    role: session.user.role,
    email: session.user.email ?? null,
    flow: session.user.flow,
  };
}
