import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { CustomerListRow } from "@/components/admin/CustomerListRow";

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
              WHERE ll.customer_id = pos_customers.id) AS points,
            (SELECT l.name FROM pos_locations pl
               JOIN locations l ON l.id = pl.wms_location_id
              WHERE pl.id = pos_customers.pos_location_id) AS created_location
       FROM pos_customers
       ${where}
      ORDER BY last_name NULLS LAST, first_name
      LIMIT 200`,
    args,
  );
  return (
    <AdminShell email={cashier.email} active="customers" code={code}>
      <section className="p-3 sm:p-6">
        <div className="flex items-end justify-between mb-5 gap-3 flex-wrap">
          <form className="flex gap-3 items-end">
            <label className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted">
              <span className="block mb-1.5">Search</span>
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Name, email, phone…"
                className="carbon-input tap-lg w-56 sm:w-80 text-base"
              />
            </label>
            <button
              type="submit"
              className="carbon-btn-primary tap-lg inline-flex items-center justify-center px-7 text-base font-semibold"
            >
              Search
            </button>
          </form>
          <Link
            href={`/customers/${code}/new`}
            className="carbon-btn-primary tap-lg inline-flex items-center justify-center px-7 text-base font-semibold"
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
                <th className="px-3 py-2">Created at</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
                  >
                    No customers yet.
                  </td>
                </tr>
              ) : (
                r.rows.map((c) => (
                  <CustomerListRow
                    key={c.id}
                    code={code}
                    c={{
                      id: c.id,
                      first_name: c.first_name,
                      last_name: c.last_name,
                      phone: c.phone,
                      phone_2: c.phone_2,
                      email: c.email,
                      email_2: c.email_2,
                      sales_count: c.sales_count,
                      points: c.points,
                      created: c.created_at
                        ? new Date(c.created_at).toLocaleDateString()
                        : null,
                      created_location: c.created_location ?? null,
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
