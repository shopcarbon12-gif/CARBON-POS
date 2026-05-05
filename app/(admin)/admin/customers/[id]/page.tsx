import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { CustomerEditor } from "./CustomerEditor";
import { StoreCreditAdjuster } from "./StoreCreditAdjuster";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/customers");
  }
  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid)) notFound();
  const pool = getPool();
  const [c, sales] = await Promise.all([
    pool.query(`SELECT * FROM pos_customers WHERE id = $1`, [cid]),
    pool.query(
      `SELECT s.id, s.sale_number, s.total_amount, s.status, s.completed_at,
              r.name AS register_name
         FROM pos_sales s
         JOIN pos_registers r ON r.id = s.register_id
        WHERE s.customer_id = $1
        ORDER BY s.completed_at DESC NULLS LAST
        LIMIT 100`,
      [cid],
    ),
  ]);
  const customer = c.rows[0];
  if (!customer) notFound();
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href="/admin/customers"
          className="text-sm text-[var(--color-pos-muted)] underline"
        >
          ← All customers
        </Link>
        <h1 className="text-xl font-bold mt-1">
          {[customer.first_name, customer.last_name].filter(Boolean).join(" ")}
        </h1>
        <p className="text-xs text-[var(--color-pos-muted)]">
          Customer since {new Date(customer.created_at).toLocaleDateString()}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
        <section className="lg:col-span-2">
          <CustomerEditor initial={customer} />
        </section>
        <aside className="flex flex-col gap-4">
          <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
            <p className="text-xs text-[var(--color-pos-muted)]">Store credit</p>
            <p className="total-display text-3xl mt-1">
              {formatMoney(customer.store_credit_balance)}
            </p>
            <StoreCreditAdjuster customerId={cid} />
          </div>
          <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
            <h2 className="font-semibold mb-2">Purchase history</h2>
            {sales.rows.length === 0 ? (
              <p className="text-sm text-[var(--color-pos-muted)]">
                No purchases yet.
              </p>
            ) : (
              <ul className="text-sm divide-y divide-[var(--color-pos-border)]">
                {sales.rows.map((s) => (
                  <li
                    key={s.id}
                    className="py-2 flex items-center justify-between"
                  >
                    <span>
                      <Link
                        className="hover:underline"
                        href={`/admin/sales/${s.id}`}
                      >
                        {s.sale_number}
                      </Link>
                      <br />
                      <span className="text-xs text-[var(--color-pos-muted)]">
                        {s.completed_at &&
                          new Date(s.completed_at).toLocaleDateString()}{" "}
                        · {s.register_name}
                      </span>
                    </span>
                    <span className="text-right font-medium tabular-nums">
                      {formatMoney(s.total_amount)}
                      <br />
                      <span className="text-xs text-[var(--color-pos-muted)]">
                        {s.status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
