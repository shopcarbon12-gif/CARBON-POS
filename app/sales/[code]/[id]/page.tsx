import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";

/**
 * Read-only detail view for one sale: header + lines + payments + refunds.
 * Phase 2 will add line-level refund actions.
 */
export default async function AdminSaleDetailPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  await pageGuard(code, {
    tab: "sales",
    from: `/sales/${code}/${id}`,
  }, { requireRole: ["manager", "admin"] });
  const saleId = Number(id);
  if (!Number.isFinite(saleId)) notFound();
  const pool = getPool();
  const [saleRes, linesRes, paymentsRes, refundsRes] = await Promise.all([
    pool.query(
      `SELECT s.*,
              r.name AS register_name,
              l.name AS location_name,
              u.email AS cashier_email,
              c.first_name, c.last_name, c.email AS customer_email
         FROM pos_sales s
         JOIN pos_registers r  ON r.id = s.register_id
         JOIN pos_locations pl ON pl.id = s.pos_location_id
         JOIN locations l      ON l.id = pl.wms_location_id
         JOIN pos_employees pe ON pe.id = s.cashier_id
         JOIN users u          ON u.id = pe.user_id
    LEFT JOIN pos_customers c  ON c.id = s.customer_id
        WHERE s.id = $1`,
      [saleId],
    ),
    pool.query(
      `SELECT * FROM pos_sale_lines WHERE sale_id = $1 ORDER BY id`,
      [saleId],
    ),
    pool.query(
      `SELECT * FROM pos_payments WHERE sale_id = $1 ORDER BY id`,
      [saleId],
    ),
    pool.query(
      `SELECT * FROM pos_refunds WHERE original_sale_id = $1 ORDER BY id`,
      [saleId],
    ),
  ]);
  const sale = saleRes.rows[0];
  if (!sale) notFound();
  const lines = linesRes.rows;
  const payments = paymentsRes.rows;
  const refunds = refundsRes.rows;
  const customerName = [sale.first_name, sale.last_name]
    .filter(Boolean)
    .join(" ");
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4 flex items-center justify-between">
        <div>
          <Link
            href={`/dashboard/${code}`}
            className="text-sm text-[var(--color-pos-muted)] underline"
          >
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold mt-1">{sale.sale_number}</h1>
          <p className="text-xs text-[var(--color-pos-muted)]">
            {new Date(sale.completed_at ?? sale.created_at).toLocaleString()} ·{" "}
            {sale.location_name} · {sale.register_name} · {sale.cashier_email}
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            sale.status === "completed"
              ? "bg-green-50 text-green-800"
              : sale.status === "refunded"
                ? "bg-amber-50 text-amber-800"
                : sale.status === "voided"
                  ? "bg-red-50 text-red-800"
                  : "bg-zinc-100 text-zinc-700"
          }`}
        >
          {sale.status}
        </span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
        <section className="lg:col-span-2">
          <h2 className="font-semibold mb-2">Items</h2>
          <table className="w-full text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
            <thead className="bg-[var(--color-pos-bg)]">
              <tr className="text-left">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit</th>
                <th className="px-3 py-2 text-right">Discount</th>
                <th className="px-3 py-2 text-right">Tax</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-[var(--color-pos-border)]">
                  <td className="px-3 py-2">
                    {l.description}
                    {l.epc && (
                      <span className="block text-xs font-mono text-[var(--color-pos-muted)]">
                        EPC {l.epc}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{l.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(l.unit_price)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(l.discount_amount) > 0
                      ? `-${formatMoney(l.discount_amount)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(l.tax_amount)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(l.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {refunds.length > 0 && (
            <>
              <h2 className="font-semibold mt-6 mb-2">Refunds</h2>
              <table className="w-full text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
                <thead className="bg-[var(--color-pos-bg)]">
                  <tr className="text-left">
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-[var(--color-pos-border)]"
                    >
                      <td className="px-3 py-2">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{r.method}</td>
                      <td className="px-3 py-2">{r.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        −{formatMoney(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
            <h2 className="font-semibold mb-2">Totals</h2>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-[var(--color-pos-muted)]">Subtotal</dt>
              <dd className="text-right tabular-nums">
                {formatMoney(sale.subtotal)}
              </dd>
              <dt className="text-[var(--color-pos-muted)]">Discount</dt>
              <dd className="text-right tabular-nums">
                −{formatMoney(sale.discount_amount)}
              </dd>
              <dt className="text-[var(--color-pos-muted)]">Tax</dt>
              <dd className="text-right tabular-nums">
                {formatMoney(sale.tax_amount)}
              </dd>
              <dt className="font-bold text-base">Total</dt>
              <dd className="text-right font-bold text-base tabular-nums">
                {formatMoney(sale.total_amount)}
              </dd>
            </dl>
          </div>

          <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
            <h2 className="font-semibold mb-2">Payments</h2>
            {payments.length === 0 ? (
              <p className="text-sm text-[var(--color-pos-muted)]">
                No payments recorded.
              </p>
            ) : (
              <ul className="text-sm">
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex justify-between py-1 border-b border-[var(--color-pos-border)] last:border-b-0"
                  >
                    <span>
                      {p.method}
                      {p.method === "cash" && p.cash_given && (
                        <span className="text-xs text-[var(--color-pos-muted)] ml-2">
                          (got {formatMoney(p.cash_given)} · change{" "}
                          {formatMoney(p.change_given ?? 0)})
                        </span>
                      )}
                      {p.method === "check" && p.check_number && (
                        <span className="text-xs text-[var(--color-pos-muted)] ml-2">
                          #{p.check_number}
                        </span>
                      )}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {customerName && (
            <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
              <h2 className="font-semibold mb-1">Customer</h2>
              <p>{customerName}</p>
              {sale.customer_email && (
                <p className="text-xs text-[var(--color-pos-muted)]">
                  {sale.customer_email}
                </p>
              )}
            </div>
          )}

          {sale.notes && (
            <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
              <h2 className="font-semibold mb-1">Notes</h2>
              <p className="text-sm whitespace-pre-line">{sale.notes}</p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
