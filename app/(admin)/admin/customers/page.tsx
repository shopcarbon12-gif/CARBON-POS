import Link from "next/link";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/customers");
  }
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const args: unknown[] = [];
  let where = "";
  if (q.length > 0) {
    args.push(`%${q}%`);
    where =
      "WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1";
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, first_name, last_name, email, phone, customer_type,
            store_credit_balance,
            (SELECT COUNT(*) FROM pos_sales s
              WHERE s.customer_id = pos_customers.id
                AND s.status = 'completed') AS sales_count
       FROM pos_customers
       ${where}
      ORDER BY last_name NULLS LAST, first_name
      LIMIT 200`,
    args,
  );
  return (
    <AdminShell email={cashier.email} active="customers">
      <section className="p-6">
        <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
          <form className="flex gap-2 items-end">
            <label className="text-xs font-medium text-[var(--color-pos-muted)]">
              <span className="block mb-1">Search</span>
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Name, email, phone"
                className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
              />
            </label>
            <button
              type="submit"
              className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-4"
            >
              Search
            </button>
          </form>
          <Link
            href="/admin/customers/new"
            className="tap rounded-xl bg-[var(--color-pos-accent)] text-white font-semibold px-5"
          >
            + New customer
          </Link>
        </div>

        <table className="w-full text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
          <thead className="bg-[var(--color-pos-bg)]">
            <tr className="text-left">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Sales</th>
              <th className="px-3 py-2 text-right">Store credit</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
                >
                  No customers yet.
                </td>
              </tr>
            ) : (
              r.rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-[var(--color-pos-border)]"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/customers/${c.id}`}
                      className="hover:underline"
                    >
                      {[c.first_name, c.last_name].filter(Boolean).join(" ") ||
                        "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{c.email ?? "—"}</td>
                  <td className="px-3 py-2">{c.phone ?? "—"}</td>
                  <td className="px-3 py-2">{c.customer_type}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.sales_count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(c.store_credit_balance)}
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
