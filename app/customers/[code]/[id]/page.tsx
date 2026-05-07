import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { AdminShell } from "@/components/admin/AdminShell";
import { CustomerForm, type CustomerFormInitial } from "@/components/admin/CustomerForm";
import { StoreCreditAdjuster } from "./StoreCreditAdjuster";

/**
 * Customer detail / edit page. Uses the same shared CustomerForm as the
 * /new route so the field layout stays consistent — the only difference
 * is that here we hydrate the form from the row and surface the read-only
 * "Created" line (timestamp + email of the user who created the record).
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  const cashier = await pageGuard(
    code,
    { tab: "customers", from: `/customers/${code}/${id}` },
    { requireRole: ["manager", "admin"] },
  );
  const cid = Number(id);
  if (!Number.isFinite(cid)) notFound();
  const pool = getPool();
  const [c, sales] = await Promise.all([
    pool.query(
      `SELECT pc.*, u.email AS created_by_email
         FROM pos_customers pc
         LEFT JOIN users u ON u.id = pc.created_by_user_id
        WHERE pc.id = $1`,
      [cid],
    ),
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

  const initial: CustomerFormInitial = {
    id: customer.id,
    customer_type: customer.customer_type,
    first_name: customer.first_name,
    last_name: customer.last_name,
    company: customer.company,
    birthday: customer.birthday
      ? new Date(customer.birthday).toISOString().slice(0, 10)
      : null,
    home_phone: customer.home_phone,
    work_phone: customer.work_phone,
    mobile_phone: customer.mobile_phone,
    email: customer.email,
    email_2: customer.email_2,
    country: customer.country,
    address_line1: customer.address_line1,
    address_line2: customer.address_line2,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    tags: Array.isArray(customer.tags) ? customer.tags : null,
    contact_consent: !!customer.contact_consent,
    contact_email_ok: !!customer.contact_email_ok,
    contact_mail_ok: !!customer.contact_mail_ok,
    contact_call_ok: !!customer.contact_call_ok,
    notes: customer.notes,
    created_at: customer.created_at,
    created_by_email: customer.created_by_email ?? null,
  };

  return (
    <AdminShell
      email={cashier.email}
      active="customers"
      code={code}
      title={[customer.first_name, customer.last_name].filter(Boolean).join(" ") || "Customer"}
    >
      <section className="p-6 max-w-7xl">
        <Link
          href={`/customers/${code}`}
          className="text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
        >
          ← All customers
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          {[customer.first_name, customer.last_name].filter(Boolean).join(" ")}
        </h1>
        <p className="text-xs text-[var(--color-pos-muted)] mb-6">
          Customer since {new Date(customer.created_at).toLocaleDateString()}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <CustomerForm code={code} initial={initial} />

          <aside className="space-y-4">
            <div className="bg-white border border-[var(--color-pos-border)] p-4">
              <p className="text-xs text-[var(--color-pos-muted)]">
                Store credit
              </p>
              <p className="total-display text-3xl mt-1">
                {formatMoney(customer.store_credit_balance)}
              </p>
              <StoreCreditAdjuster customerId={cid} />
            </div>
            <div className="bg-white border border-[var(--color-pos-border)] p-4">
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
                          href={`/sales/${code}/${s.id}`}
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
      </section>
    </AdminShell>
  );
}
