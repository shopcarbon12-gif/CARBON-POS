import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { LookupClient } from "./LookupClient";

/**
 * Product Lookup. The cashier types a SKU / UPC / name and gets back price,
 * stock at the active location, and a count of "in transit toward this
 * location" — without starting a sale. Useful at the floor for "do we have
 * this in size M?" questions.
 */
export default async function LookupPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "sales",
    from: `/sales/${code}/lookup`,
  });

  return (
    <AdminShell
      email={cashier.email}
      active="sales"
      code={code}
      title="Lookup"
    >
      <section className="p-6">
        <LookupClient locationId={cashier.lid} code={code} />
      </section>
    </AdminShell>
  );
}
