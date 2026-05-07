import { redirect } from "next/navigation";
import { currentCashier } from "@/lib/session";

/**
 * Root entry. Authenticated visitors land at /dashboard/<their location code>;
 * everyone else gets sent to /sign-in.
 */
export default async function HomePage() {
  const cashier = await currentCashier();
  if (cashier?.lcode) {
    redirect(`/dashboard/${cashier.lcode}`);
  }
  redirect("/sign-in");
}
