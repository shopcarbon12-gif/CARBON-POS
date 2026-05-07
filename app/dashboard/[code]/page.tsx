import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { AdminShell, Stat } from "@/components/admin/AdminShell";

/**
 * Authenticated landing page after PIN sign-in. Today snapshot + a
 * recent-sales table for the active location.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "dashboard",
    from: `/dashboard/${code}`,
  });

  const pool = getPool();
  const [today, recent, openSessions] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(s.total_amount), 0) AS revenue,
         COUNT(*)                         AS tx_count,
         COALESCE(SUM(s.tax_amount), 0)   AS tax,
         COALESCE(SUM(s.discount_amount), 0) AS discount
       FROM pos_sales s
      WHERE s.status = 'completed'
        AND s.completed_at::date = current_date
        AND s.pos_location_id IN (
          SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid
        )`,
      [cashier.lid],
    ),
    pool.query(
      `SELECT s.id, s.sale_number, s.total_amount, s.completed_at, s.status,
              r.name AS register_name,
              u.email AS cashier_email
         FROM pos_sales s
         JOIN pos_registers r ON r.id = s.register_id
         JOIN pos_employees pe ON pe.id = s.cashier_id
         JOIN users u ON u.id = pe.user_id
        WHERE s.status IN ('completed','refunded')
          AND s.pos_location_id IN (
            SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid
          )
        ORDER BY s.completed_at DESC NULLS LAST
        LIMIT 25`,
      [cashier.lid],
    ),
    pool.query(
      `SELECT s.id, r.name AS register_name, s.opening_cash, s.opened_at,
              u.email AS opened_by_email
         FROM pos_register_sessions s
         JOIN pos_registers r ON r.id = s.register_id
         JOIN users u         ON u.id = s.opened_by
        WHERE s.status = 'open'
          AND r.pos_location_id IN (
            SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid
          )
        ORDER BY s.opened_at`,
      [cashier.lid],
    ),
  ]);
  const t = today.rows[0];
  return (
    <AdminShell email={cashier.email} active="dashboard" code={code}>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Stat label="Today's revenue" value={formatMoney(t.revenue)} />
        <Stat label="Transactions" value={String(t.tx_count)} />
        <Stat label="Tax collected" value={formatMoney(t.tax)} />
        <Stat label="Discounts given" value={formatMoney(t.discount)} />
      </div>

      <section className="px-6 pb-6">
        <h2 className="font-semibold mb-2">Open registers</h2>
        {openSessions.rows.length === 0 ? (
          <p className="text-sm text-[var(--color-pos-muted)]">
            No registers are open right now.
          </p>
        ) : (
          <table className="w-full text-sm border border-[var(--color-pos-border)] overflow-hidden">
            <thead className="bg-[var(--color-pos-bg)]">
              <tr className="text-left">
                <th className="px-3 py-2">Register</th>
                <th className="px-3 py-2">Cashier</th>
                <th className="px-3 py-2">Opened</th>
                <th className="px-3 py-2 text-right">Opening cash</th>
              </tr>
            </thead>
            <tbody>
              {openSessions.rows.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-[var(--color-pos-border)]"
                >
                  <td className="px-3 py-2">{s.register_name}</td>
                  <td className="px-3 py-2">{s.opened_by_email}</td>
                  <td className="px-3 py-2">
                    {new Date(s.opened_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(s.opening_cash)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="px-6 pb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Recent sales</h2>
          <Link
            href={`/sales/${code}`}
            className="text-sm text-[var(--color-pos-muted)] underline"
          >
            See all sales →
          </Link>
        </div>
        <table className="w-full text-sm border border-[var(--color-pos-border)] overflow-hidden">
          <thead className="bg-[var(--color-pos-bg)]">
            <tr className="text-left">
              <th className="px-3 py-2">Sale</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Register</th>
              <th className="px-3 py-2">Cashier</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {recent.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
                >
                  No sales yet.
                </td>
              </tr>
            ) : (
              recent.rows.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-[var(--color-pos-border)]"
                >
                  <td className="px-3 py-2">
                    <Link href={`/sales/${code}/${s.id}`}>{s.sale_number}</Link>
                  </td>
                  <td className="px-3 py-2">
                    {s.completed_at &&
                      new Date(s.completed_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{s.register_name}</td>
                  <td className="px-3 py-2">{s.cashier_email}</td>
                  <td className="px-3 py-2">{s.status}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(s.total_amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
