import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { AdminShell } from "@/components/admin/AdminShell";
import { CustomerForm, type CustomerFormInitial } from "@/components/admin/CustomerForm";
import { StoreCreditAdjuster } from "./StoreCreditAdjuster";
import { isStoreCreditApprover } from "@/lib/store-credit";

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
      `SELECT s.id, s.sale_number, s.subtotal, s.discount_amount, s.tax_amount,
              s.total_amount, s.status, s.completed_at, s.created_at,
              r.name AS register_name,
              (SELECT COALESCE(SUM(sl.quantity), 0)
                 FROM pos_sale_lines sl WHERE sl.sale_id = s.id) AS item_count
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
    first_name: customer.first_name,
    last_name: customer.last_name,
    birthday: customer.birthday
      ? new Date(customer.birthday).toISOString().slice(0, 10)
      : null,
    phone: customer.phone,
    phone_2: customer.phone_2,
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
      <section className="p-6">
        <Link
          href={`/customers/${code}`}
          className="text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
        >
          ← All customers
        </Link>
        <h1 className="text-2xl font-bold mt-2 break-words">
          {[customer.first_name, customer.last_name].filter(Boolean).join(" ")}
        </h1>
        <p className="text-sm text-carbon-text-muted mt-1 mb-6 max-w-2xl">
          Customer since {new Date(customer.created_at).toLocaleDateString()}.
          Edit their details below — changes save when you press Save.
        </p>

        <CustomerForm code={code} initial={initial} />

        {/* Account cards — full width below the form, same card styling as
            the form sections so the page reads as one continuous sheet. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="border border-carbon-border bg-white p-4 min-w-0">
            <p className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted">
              Store credit
            </p>
            <p className="total-display text-3xl mt-1 break-words">
              {formatMoney(customer.store_credit_balance)}
            </p>
            <StoreCreditAdjuster
              customerId={cid}
              isApprover={isStoreCreditApprover(cashier.email)}
            />
          </div>

          <div className="border border-carbon-border bg-white p-4 min-w-0 lg:col-span-2">
            <h2 className="text-sm font-bold tracking-tight mb-2">
              Purchase history
            </h2>
            {sales.rows.length === 0 ? (
              <p className="text-sm text-carbon-text-muted">No purchases yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-carbon-surface-soft text-left text-xs uppercase tracking-wider text-carbon-text-muted">
                    <tr>
                      <th className="px-3 py-2 font-bold">Sale #</th>
                      <th className="px-3 py-2 font-bold">Date</th>
                      <th className="px-3 py-2 font-bold">Register</th>
                      <th className="px-3 py-2 font-bold text-right">Items</th>
                      <th className="px-3 py-2 font-bold text-right">Subtotal</th>
                      <th className="px-3 py-2 font-bold text-right">Discount</th>
                      <th className="px-3 py-2 font-bold text-right">Tax</th>
                      <th className="px-3 py-2 font-bold text-right">Total</th>
                      <th className="px-3 py-2 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.rows.map((s) => (
                      <tr
                        key={s.id}
                        className="border-t border-carbon-border-soft"
                      >
                        <td className="px-3 py-2">
                          <Link
                            className="hover:underline tabular-nums text-carbon-blue font-medium"
                            href={`/sales/${code}/${s.id}`}
                          >
                            {s.sale_number}
                          </Link>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-carbon-text-muted">
                          {s.completed_at || s.created_at
                            ? new Date(
                                s.completed_at ?? s.created_at,
                              ).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {s.register_name}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.item_count}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoney(s.subtotal)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {Number(s.discount_amount) > 0
                            ? `−${formatMoney(s.discount_amount)}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoney(s.tax_amount)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {formatMoney(s.total_amount)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-semibold ${
                              s.status === "completed"
                                ? "bg-[rgba(22,138,63,0.10)] text-carbon-success"
                                : s.status === "refunded" ||
                                    s.status === "voided"
                                  ? "bg-[rgba(186,26,26,0.08)] text-carbon-danger"
                                  : "bg-carbon-surface-soft text-carbon-text-muted"
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
