import Link from "next/link";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function SettingsHomePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "settings",
    from: `/settings/${code}`,
  }, { requireRole: ["manager", "admin"] });
  const cards: { href: string; title: string; desc: string }[] = [
    {
      href: `/settings/${code}/locations`,
      title: "Locations",
      desc: "Tax rate, address, receipt header/footer, return policy, timezone.",
    },
    {
      href: `/settings/${code}/registers`,
      title: "Registers",
      desc: "Add/rename tills and pair them with their Stripe Terminal reader.",
    },
    {
      href: `/employees/${code}`,
      title: "Employees",
      desc:
        "Cashiers and back-office staff. PINs are 4-digit codes used at the register.",
    },
    {
      href: `/settings/${code}/discounts`,
      title: "Discount rules",
      desc:
        "Promotions: percent or fixed off, gated on customer type, sku, or date range.",
    },
    {
      href: `/settings/${code}/readers`,
      title: "Stripe readers",
      desc: "List paired card readers; assign each one to a register.",
    },
  ];
  return (
    <AdminShell email={cashier.email} active="settings" code={code}>
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
