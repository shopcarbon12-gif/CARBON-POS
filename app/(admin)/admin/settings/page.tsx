import Link from "next/link";
import { redirect } from "next/navigation";
import { currentCashier } from "@/lib/session";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function SettingsHomePage() {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/settings");
  }
  const cards: { href: string; title: string; desc: string }[] = [
    {
      href: "/admin/settings/locations",
      title: "Locations",
      desc: "Tax rate, address, receipt header/footer, return policy, timezone.",
    },
    {
      href: "/admin/settings/registers",
      title: "Registers",
      desc: "Add/rename tills and pair them with their Stripe Terminal reader.",
    },
    {
      href: "/admin/settings/discounts",
      title: "Discount rules",
      desc:
        "Promotions: percent or fixed off, gated on customer type, sku, or date range.",
    },
    {
      href: "/admin/settings/readers",
      title: "Stripe readers",
      desc: "List paired card readers; assign each one to a register.",
    },
  ];
  return (
    <AdminShell email={cashier.email} active="settings">
      <section className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
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
