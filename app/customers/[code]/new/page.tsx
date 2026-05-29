import Link from "next/link";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { CustomerForm } from "@/components/admin/CustomerForm";

/**
 * New customer page. Server component for the auth gate; the form itself
 * is the shared CustomerForm used on both the new + edit screens so the
 * field set / layout stay in lockstep.
 */
export default async function NewCustomerPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(
    code,
    { tab: "customers", from: `/customers/${code}/new` },
    { requireRole: ["manager", "admin"] },
  );
  return (
    <AdminShell
      email={cashier.email}
      active="customers"
      code={code}
      title="New customer"
    >
      <section className="p-6 max-w-7xl">
        <Link
          href={`/customers/${code}`}
          className="text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
        >
          ← All customers
        </Link>
        <h1 className="text-2xl font-bold mt-2">New customer</h1>
        <p className="text-sm text-carbon-text-muted mt-1 mb-6 max-w-2xl">
          Add a profile so you can attach sales, track loyalty, and reach out
          with their consent. Only a first name is required to get started.
        </p>
        <CustomerForm code={code} initial={null} />
      </section>
    </AdminShell>
  );
}
