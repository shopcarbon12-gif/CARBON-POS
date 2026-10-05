import { Fragment } from "react";
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
  const [c, purchases, creditLog] = await Promise.all([
    pool.query(
      `SELECT pc.*, u.email AS created_by_email,
              (SELECT l.name FROM pos_locations pl
                 JOIN locations l ON l.id = pl.wms_location_id
                WHERE pl.id = pc.pos_location_id) AS created_location
         FROM pos_customers pc
         LEFT JOIN users u ON u.id = pc.created_by_user_id
        WHERE pc.id = $1`,
      [cid],
    ),
    // Combined in-store + online history from the shared
    // customer_purchases view (owned by Carbon-Rewards). Online rows pull
    // their line items from shopify_orders for the inline item list.
    pool.query(
      `SELECT cp.channel, cp.ref, cp.number, cp.placed_at, cp.total,
              cp.status, cp.location_name, cp.item_count,
              so.line_items
         FROM customer_purchases cp
         LEFT JOIN shopify_orders so
           ON cp.channel = 'online' AND so.order_gid = cp.ref
        WHERE cp.customer_id = $1
        ORDER BY cp.placed_at DESC NULLS LAST
        LIMIT 100`,
      [cid],
    ),
    // Store credit movements (refunds in, purchases out, adjustments).
    pool.query(
      `SELECT g.id, g.delta, g.balance_after, g.kind, g.reason, g.created_at,
              g.sale_id, g.refund_id
         FROM pos_store_credit_ledger g
        WHERE g.customer_id = $1
        ORDER BY g.created_at DESC
        LIMIT 15`,
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
          Customer since {new Date(customer.created_at).toLocaleDateString()}
          {customer.created_location
            ? ` · Created at ${customer.created_location}`
            : ""}
          . Edit their details below — changes save when you press Save.
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
            {creditLog.rows.length > 0 && (
              <div className="mt-4 border-t border-carbon-border-soft pt-3">
                <p className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted mb-2">
                  History
                </p>
                <ul className="text-sm divide-y divide-carbon-border-soft">
                  {creditLog.rows.map((g) => {
                    const delta = Number(g.delta);
                    const href = g.refund_id
                      ? `/sales/${code}/refund/receipt?refund=${g.refund_id}&back=${encodeURIComponent(`/customers/${code}/${cid}`)}`
                      : g.sale_id
                        ? `/sales/${code}/${g.sale_id}`
                        : null;
                    const label =
                      g.kind === "refund"
                        ? "Refund to credit"
                        : g.kind === "purchase"
                          ? "Used on purchase"
                          : g.kind === "exchange"
                            ? "Exchange"
                            : "Adjustment";
                    return (
                      <li key={g.id} className="py-1.5 flex justify-between gap-3">
                        <span className="min-w-0">
                          {href ? (
                            <Link href={href} className="font-semibold text-carbon-blue hover:underline">
                              {label}
                            </Link>
                          ) : (
                            <span className="font-semibold">{label}</span>
                          )}
                          <span className="block text-xs text-carbon-text-muted truncate">
                            {new Date(g.created_at).toLocaleDateString("en-US", {
                              timeZone: "America/New_York",
                            })}
                            {g.reason ? ` · ${g.reason}` : ""}
                          </span>
                        </span>
                        <span className="text-right shrink-0 tabular-nums">
                          <span className={delta < 0 ? "text-carbon-danger font-semibold" : "text-emerald-700 font-semibold"}>
                            {delta < 0 ? `-${formatMoney(-delta)}` : `+${formatMoney(delta)}`}
                          </span>
                          <span className="block text-xs text-carbon-text-muted">
                            bal {formatMoney(g.balance_after)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          <div className="border border-carbon-border bg-white p-4 min-w-0 lg:col-span-2">
            <h2 className="text-sm font-bold tracking-tight mb-2">
              Purchase history
            </h2>
            {purchases.rows.length === 0 ? (
              <p className="text-sm text-carbon-text-muted">No purchases yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-carbon-surface-soft text-left text-xs uppercase tracking-wider text-carbon-text-muted">
                    <tr>
                      <th className="px-3 py-2 font-bold">Channel</th>
                      <th className="px-3 py-2 font-bold">Number</th>
                      <th className="px-3 py-2 font-bold">Date</th>
                      <th className="px-3 py-2 font-bold">Store</th>
                      <th className="px-3 py-2 font-bold text-right">Items</th>
                      <th className="px-3 py-2 font-bold text-right">Total</th>
                      <th className="px-3 py-2 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.rows.map((p) => {
                      const online = p.channel === "online";
                      const lineItems: ShopifyLineItem[] = Array.isArray(p.line_items)
                        ? p.line_items
                        : [];
                      return (
                        <Fragment key={`${p.channel}:${p.ref}`}>
                          <tr className="border-t border-carbon-border-soft">
                            <td className="px-3 py-2">
                              <span
                                className={`inline-block px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
                                  online
                                    ? "border border-carbon-blue text-carbon-blue"
                                    : "bg-carbon-surface-soft text-carbon-text-muted"
                                }`}
                              >
                                {online ? "Online" : "In-store"}
                              </span>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {online ? (
                                <a
                                  className="hover:underline tabular-nums text-carbon-blue font-medium"
                                  href={shopifyAdminOrderUrl(p.ref)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {p.number} ↗
                                </a>
                              ) : (
                                <Link
                                  className="hover:underline tabular-nums text-carbon-blue font-medium"
                                  href={`/sales/${code}/${p.ref}`}
                                >
                                  {p.number}
                                </Link>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-carbon-text-muted">
                              {p.placed_at
                                ? new Date(p.placed_at).toLocaleDateString()
                                : "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {p.location_name ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {p.item_count}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">
                              {formatMoney(p.total)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-block px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
                                  p.status === "completed"
                                    ? "bg-[rgba(22,138,63,0.10)] text-carbon-success"
                                    : p.status === "refunded" ||
                                        p.status === "cancelled"
                                      ? "bg-[rgba(186,26,26,0.08)] text-carbon-danger"
                                      : "bg-carbon-surface-soft text-carbon-text-muted"
                                }`}
                              >
                                {String(p.status).replace(/_/g, " ")}
                              </span>
                            </td>
                          </tr>
                          {/* Online orders have no POS sale page — show the
                              Shopify line items inline (collapsed). */}
                          {online && lineItems.length > 0 ? (
                            <tr>
                              <td />
                              <td colSpan={6} className="px-3 pb-2">
                                <details className="text-xs">
                                  <summary className="cursor-pointer text-carbon-text-muted hover:text-carbon-blue">
                                    Show {lineItems.length}{" "}
                                    {lineItems.length === 1 ? "line" : "lines"}
                                  </summary>
                                  <ul className="mt-1 space-y-0.5">
                                    {lineItems.map((li, i) => (
                                      <li key={i} className="flex gap-3">
                                        <span className="tabular-nums text-carbon-text-muted">
                                          {li.quantity}×
                                        </span>
                                        <span className="flex-1 min-w-0 break-words">
                                          {li.title}
                                          {li.variant_title ? ` · ${li.variant_title}` : ""}
                                          {li.sku ? (
                                            <span className="text-carbon-text-muted">
                                              {" "}
                                              ({li.sku})
                                            </span>
                                          ) : null}
                                        </span>
                                        <span className="tabular-nums">
                                          {formatMoney(li.price)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
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

type ShopifyLineItem = {
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  price: string | number;
};

/** Shopify admin link from an order gid (gid://shopify/Order/123). */
function shopifyAdminOrderUrl(gid: string): string {
  const numericId = gid.split("/").pop() ?? "";
  return `https://admin.shopify.com/store/shopcarbon1/orders/${numericId}`;
}
