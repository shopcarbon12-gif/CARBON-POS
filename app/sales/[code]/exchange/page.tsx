import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { ExchangeClient } from "./ExchangeClient";

/**
 * Exchange, step 1: find the original receipt and pick the items coming
 * back. Their value becomes exchange credit on the cart (step 2, the
 * normal sell screen), and checkout charges or gives back the difference
 * (lib/exchange + capture route).
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
    <AdminShell email={cashier.email} active="sales" code={code} title="Exchange">
      <section className="p-4 sm:p-6 max-w-3xl">
        <ExchangeClient code={code} />
      </section>
    </AdminShell>
  );
}
