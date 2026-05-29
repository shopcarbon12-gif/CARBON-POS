import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "customers",
    from: `/customers/${code}`,
  });
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const args: unknown[] = [];
  let where = "";
  if (q.length > 0) {
    args.push(`%${q}%`);
    where =
      `WHERE first_name ILIKE $1 OR last_name ILIKE $1
         OR email ILIKE $1 OR email_2 ILIKE $1
         OR phone ILIKE $1 OR phone_2 ILIKE $1`;
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, first_name, last_name, email, email_2, phone, phone_2,
            created_at,
            (SELECT COUNT(*) FROM pos_sales s
              WHERE s.customer_id = pos_customers.id
                AND s.status = 'completed') AS sales_count,
            (SELECT COALESCE(SUM(ll.delta_points), 0) FROM loyalty_ledger ll
              WHERE ll.customer_id = pos_customers.id) AS points
       FROM pos_customers
       ${where}
      ORDER BY last_name NULLS LAST, first_name
      LIMIT 200`,
    args,
  );
  return (
    <AdminShell email={cashier.email} active="customers" code={code}>
      <section className="p-3 sm:p-6">
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
            href={`/customers/${code}/new`}
            className="tap rounded-xl bg-[var(--color-pos-accent)] text-white font-semibold px-5"
          >
            + New customer
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
            <thead className="bg-[var(--color-pos-bg)]">
              <tr className="text-left">
                <th className="px-3 py-2">First name</th>
                <th className="px-3 py-2">Last name</th>
                <th className="px-3 py-2">Phone 1</th>
                <th className="px-3 py-2">Phone 2</th>
                <th className="px-3 py-2">Email 1</th>
                <th className="px-3 py-2">Email 2</th>
                <th className="px-3 py-2 text-right">Sales</th>
                <th className="px-3 py-2 text-right">Points</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
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
                        href={`/customers/${code}/${c.id}`}
                        className="font-medium text-carbon-blue hover:underline"
                      >
                        {c.first_name || "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{c.last_name ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{c.phone ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{c.phone_2 ?? "—"}</td>
                    <td className="px-3 py-2">{c.email ?? "—"}</td>
                    <td className="px-3 py-2">{c.email_2 ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.sales_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(c.points).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[var(--color-pos-muted)]">
                      {c.created_at
                        ? new Date(c.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
