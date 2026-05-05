import { redirect } from "next/navigation";
import { currentCashier } from "@/lib/session";

/**
 * Touch-UI shell. Anything under (pos) requires an authenticated cashier
 * and renders against the light register theme.
 */
export default async function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cashier = await currentCashier();
  if (!cashier) {
    redirect("/sign-in?from=/pos");
  }
  return (
    <div className="min-h-screen bg-[var(--color-pos-bg)] text-[var(--color-pos-ink)]">
      {children}
    </div>
  );
}
