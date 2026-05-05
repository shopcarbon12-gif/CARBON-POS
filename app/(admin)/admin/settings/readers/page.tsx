import Link from "next/link";
import { redirect } from "next/navigation";
import { currentCashier } from "@/lib/session";
import { ReadersManager } from "./ReadersManager";

export default async function ReadersSettingsPage() {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/settings/readers");
  }
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href="/admin/settings"
          className="text-sm text-[var(--color-pos-muted)] underline"
        >
          ← Settings
        </Link>
        <h1 className="text-xl font-bold mt-1">Stripe Terminal readers</h1>
        <p className="text-xs text-[var(--color-pos-muted)] mt-1">
          Pair each register to a card reader. The cashier app sends payments
          to whichever reader is paired with the register they opened.
        </p>
      </header>
      <section className="p-6">
        <ReadersManager />
      </section>
    </main>
  );
}
