import Link from "next/link";
import { redirect } from "next/navigation";
import { currentCashier } from "@/lib/session";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function ReportsHomePage() {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/reports");
  }
  const cards: { href: string; title: string; desc: string }[] = [
    {
      href: "/admin/reports/end-of-day",
      title: "End of Day",
      desc: "Per-register totals + payment method breakdown for one day.",
    },
    {
      href: "/admin/reports/sales-tax",
      title: "Sales Tax",
      desc: "Day-by-day tax collected over a date range. CSV for the accountant.",
    },
    {
      href: "/admin/reports/by-product",
      title: "Sales by Product",
      desc: "Quantity & revenue per SKU for a date range.",
    },
    {
      href: "/admin/reports/by-employee",
      title: "Sales by Employee",
      desc: "Cashier productivity for a date range.",
    },
    {
      href: "/admin/reports/discounts",
      title: "Discounts Applied",
      desc: "Every discount line in a date range — useful for spotting patterns.",
    },
    {
      href: "/admin/reports/cash-drawer",
      title: "Cash Drawer Log",
      desc: "Every closed register session, drops, payouts, over/short.",
    },
    {
      href: "/admin/reports/refunds",
      title: "Refunds & Voids",
      desc: "All refunds and voided sales, with reason and who actioned them.",
    },
  ];
  return (
    <AdminShell email={cashier.email} active="reports">
      <section className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-5 hover:border-[var(--color-pos-ink)]"
            >
              <p className="font-semibold">{c.title}</p>
              <p className="text-sm text-[var(--color-pos-muted)] mt-1">
                {c.desc}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
