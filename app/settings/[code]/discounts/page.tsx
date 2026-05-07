import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { DiscountsManager } from "./DiscountsManager";

export default async function DiscountsSettingsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "settings",
    from: `/settings/${code}/discounts`,
  }, { requireRole: ["manager", "admin"] });
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM pos_discount_rules ORDER BY is_active DESC, name`,
  );
  return (
    <AdminShell email={cashier.email} active="settings" code={code}>
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href={`/settings/${code}`}
          className="text-sm text-[var(--color-pos-muted)] underline"
        >
          ← Settings
        </Link>
        <h1 className="text-xl font-bold mt-1">Discount rules</h1>
        <p className="text-xs text-[var(--color-pos-muted)] mt-1">
          Promotions auto-apply at the register. Phase 2 will gate large
          discounts behind a manager PIN automatically.
        </p>
      </header>
      <section className="p-6">
        <DiscountsManager rules={r.rows} />
      </section>
    </AdminShell>
  );
}
