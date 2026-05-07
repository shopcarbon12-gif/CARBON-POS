import { redirect } from "next/navigation";
import { currentCashier } from "@/lib/session";

/**
 * Standard page guard for every authenticated /<tab>/[code] page. Returns
 * the cashier when:
 *   - the user is signed in
 *   - the URL's [code] matches the session's lcode
 *
 * Otherwise it redirects:
 *   - no session  → /sign-in?from=<current>
 *   - lcode skew  → /<tab>/<cashier.lcode>  (so the URL self-corrects)
 *
 * Pass `requireRole` for back-office screens that need manager/admin
 * (we still keep a separate role gate so cashiers can't open Settings).
 */
export async function pageGuard(
  code: string,
  current: { tab: string; from?: string },
  options?: { requireRole?: Array<"cashier" | "supervisor" | "manager" | "admin"> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    redirect(`/sign-in?from=${encodeURIComponent(current.from ?? "/")}`);
  }
  if (cashier.lcode && code !== cashier.lcode) {
    redirect(`/${current.tab}/${cashier.lcode}`);
  }
  if (options?.requireRole && !options.requireRole.includes(cashier.role)) {
    redirect(`/dashboard/${cashier.lcode}`);
  }
  return cashier;
}
