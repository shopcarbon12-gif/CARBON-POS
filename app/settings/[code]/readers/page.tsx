import Link from "next/link";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { ReadersManager } from "./ReadersManager";

export default async function ReadersSettingsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "settings",
    from: `/settings/${code}/readers`,
  }, { requireRole: ["manager", "admin"] });
  return (
    <AdminShell email={cashier.email} active="settings" code={code}>
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href={`/settings/${code}`}
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
    </AdminShell>
  );
}
