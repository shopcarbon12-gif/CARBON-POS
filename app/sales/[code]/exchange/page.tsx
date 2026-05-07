import Link from "next/link";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";

/**
 * Exchange flow — placeholder. Phase 2 builds the real flow:
 *   1. Scan original receipt or look up by sale number
 *   2. Mark items as returning
 *   3. Add new items
 *   4. Settle the difference (refund or charge)
 *
 * This stub keeps the Sales-tab Exchange button visible and wired so the UX
 * isn't broken; clicking it lands here with a "coming soon" panel.
 */
export default async function ExchangePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "sales",
    from: `/sales/${code}/exchange`,
  });

  return (
    <AdminShell
      email={cashier.email}
      active="sales"
      code={code}
      title="Exchange"
    >
      <section className="p-6 max-w-2xl">
        <div className="carbon-card p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-carbon-blue">
            swap_horiz
          </span>
          <h2 className="text-xl font-bold mt-3">Exchange — Phase 2</h2>
          <p className="text-sm text-[var(--color-pos-muted)] mt-2 max-w-md mx-auto">
            The exchange flow lands in Phase 2: scan the original receipt,
            mark the returning items, add the new items, and settle the
            difference in one step.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
            <Link
              href={`/sales/${code}/refund`}
              className="carbon-btn-secondary tap px-4 inline-flex items-center"
            >
              Open a refund
            </Link>
            <Link
              href={`/sales/${code}`}
              className="carbon-btn-primary tap px-4 inline-flex items-center"
            >
              Back to Sales
            </Link>
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
