import Link from "next/link";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { DiscountsManager } from "./DiscountsManager";

export default async function DiscountsSettingsPage() {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/settings/discounts");
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM pos_discount_rules ORDER BY is_active DESC, name`,
  );
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href="/admin/settings"
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
    </main>
  );
}
