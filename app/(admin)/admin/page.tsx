import Link from "next/link";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";

/**
 * Back-office dashboard. Shows today's revenue + a quick recent-sales list.
 * Phase 2 will add the full Reports/Customers/Employees/Settings nav.
 */
export default async function AdminPage() {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin");
  }
  const pool = getPool();
  const [today, recent] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(total_amount), 0) AS revenue,
         COUNT(*)                       AS tx_count,
         COALESCE(SUM(tax_amount), 0)   AS tax,
         COALESCE(SUM(discount_amount), 0) AS discount
       FROM pos_sales
      WHERE status = 'completed'
        AND completed_at::date = current_date`,
    ),
    pool.query(
      `SELECT s.id, s.sale_number, s.total_amount, s.completed_at,
              r.name AS register_name,
              u.email AS cashier_email
         FROM pos_sales s
         JOIN pos_registers r ON r.id = s.register_id
         JOIN pos_employees pe ON pe.id = s.cashier_id
         JOIN users u ON u.id = pe.user_id
        WHERE s.status IN ('completed','refunded')
        ORDER BY s.completed_at DESC NULLS LAST
        LIMIT 25`,
    ),
  ]);
  const t = today.rows[0];
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Carbon POS — Back Office</h1>
          <p className="text-xs text-[var(--color-pos-muted)]">{cashier.email}</p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href="/admin" className="font-medium">
            Dashboard
          </Link>
          <Link href="/admin/sales" className="text-[var(--color-pos-muted)]">
            Sales
          </Link>
          <Link href="/admin/reports" className="text-[var(--color-pos-muted)]">
            Reports
          </Link>
          <Link href="/pos" className="text-[var(--color-pos-muted)] underline">
            Register →
          </Link>
        </nav>
      </header>

      <div className="p-6 grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Stat label="Today's revenue" value={formatMoney(t.revenue)} />
        <Stat label="Transactions" value={String(t.tx_count)} />
        <Stat label="Tax collected" value={formatMoney(t.tax)} />
        <Stat label="Discounts" value={formatMoney(t.discount)} />
      </div>

      <section className="px-6 pb-6">
        <h2 className="font-semibold mb-2">Recent sales</h2>
        <table className="w-full text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
          <thead className="bg-[var(--color-pos-bg)]">
            <tr className="text-left">
              <th className="px-3 py-2">Sale</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Register</th>
              <th className="px-3 py-2">Cashier</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {recent.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
                >
                  No sales yet.
                </td>
              </tr>
            ) : (
              recent.rows.map((s) => (
                <tr key={s.id} className="border-t border-[var(--color-pos-border)]">
                  <td className="px-3 py-2">
                    <Link href={`/admin/sales/${s.id}`}>{s.sale_number}</Link>
                  </td>
                  <td className="px-3 py-2">
                    {s.completed_at &&
                      new Date(s.completed_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{s.register_name}</td>
                  <td className="px-3 py-2">{s.cashier_email}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(s.total_amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
      <p className="text-xs text-[var(--color-pos-muted)]">{label}</p>
      <p className="total-display text-3xl mt-1">{value}</p>
    </div>
  );
}
