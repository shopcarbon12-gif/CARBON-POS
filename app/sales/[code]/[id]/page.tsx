import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { cardDetails } from "@/lib/receipt-pdf";
import { AdminShell } from "@/components/admin/AdminShell";
import { SaleActions } from "./SaleActions";
import { SaleLines, type SaleLineRow } from "./SaleLines";
import { SaleCustomerCard, type SaleCustomer } from "./SaleCustomerCard";
import { SaleReturnActions } from "./SaleReturnActions";

const PAY_LABEL: Record<string, string> = {
  card: "Card",
  cash: "Cash",
  store_credit: "Store credit",
  gift_card: "Gift card",
  account: "Account",
  check: "Check",
};
const REFUND_LABEL: Record<string, string> = {
  original_card: "Original card",
  cash: "Cash",
  store_credit: "Store credit",
  exchange: "Exchange",
};

/**
 * Order screen: items (tap one for its stock + tag history), returns
 * history, payments, customer (attach / change), and Exchange / Refund /
 * Re-print / Email actions.
 */
export default async function AdminSaleDetailPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  const cashier = await pageGuard(code, {
    tab: "sales",
    from: `/sales/${code}/${id}`,
  }, { requireRole: ["manager", "admin"] });
  const saleId = Number(id);
  if (!Number.isFinite(saleId)) notFound();
  const pool = getPool();

  const saleRes = await pool.query(
    `SELECT s.*,
            r.name AS register_name,
            l.name AS location_name,
            pl.timezone,
            u.email AS cashier_email,
            NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS cashier_name,
            NULLIF(trim(concat_ws(' ', au.first_name, au.last_name)), '') AS attributed_name,
            (s.attributed_employee_id <> s.cashier_id) AS attributed_differs,
            NULLIF(trim(concat_ws(' ', vu.first_name, vu.last_name)), '') AS voided_by_name
       FROM pos_sales s
       JOIN pos_registers r  ON r.id = s.register_id
       JOIN pos_locations pl ON pl.id = s.pos_location_id
       JOIN locations l      ON l.id = pl.wms_location_id
       JOIN pos_employees pe ON pe.id = s.cashier_id
       JOIN users u          ON u.id = pe.user_id
  LEFT JOIN pos_employees ae ON ae.id = s.attributed_employee_id
  LEFT JOIN users au         ON au.id = ae.user_id
  LEFT JOIN pos_employees ve ON ve.id = s.voided_by
  LEFT JOIN users vu         ON vu.id = ve.user_id
      WHERE s.id = $1`,
    [saleId],
  );
  const sale = saleRes.rows[0];
  if (!sale) notFound();

  const lines = (
    await pool.query<SaleLineRow>(
      `SELECT sl.id, sl.sku_id::text, sl.epc, sl.epcs, sl.description, sl.quantity,
              sl.unit_price::text, sl.discount_amount::text, sl.tax_amount::text,
              sl.line_total::text,
              COALESCE((SELECT sum(ri.quantity) FROM pos_refund_items ri
                         WHERE ri.sale_line_id = sl.id), 0)::int AS returned_qty,
              COALESCE((SELECT sum(ri.quantity) FROM pos_refund_items ri
                         WHERE ri.sale_line_id = sl.id AND ri.damaged), 0)::int AS damaged_qty
         FROM pos_sale_lines sl
        WHERE sl.sale_id = $1
        ORDER BY sl.id`,
      [saleId],
    )
  ).rows;

  const payments = (
    await pool.query(`SELECT * FROM pos_payments WHERE sale_id = $1 ORDER BY id`, [saleId])
  ).rows;
  const payLabels = await Promise.all(
    payments.map(async (p) =>
      p.method === "card" ? (await cardDetails(p.stripe_payment_intent_id)) ?? "Card" : PAY_LABEL[p.method] ?? p.method,
    ),
  );

  const refunds = (
    await pool.query<{
      id: number;
      created_at: string;
      method: string;
      reason: string | null;
      amount: string;
      exchange_sale_id: number | null;
      exchange_number: string | null;
      by_name: string | null;
      override_by: string | null;
      pieces: number;
    }>(
      `SELECT rf.id, rf.created_at, rf.method, rf.reason, rf.amount::text,
              rf.exchange_sale_id, xs.sale_number AS exchange_number,
              NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS by_name,
              rf.override_by,
              COALESCE((SELECT sum(quantity) FROM pos_refund_items WHERE refund_id = rf.id), 0)::int AS pieces
         FROM pos_refunds rf
    LEFT JOIN pos_sales xs     ON xs.id = rf.exchange_sale_id
    LEFT JOIN pos_employees pe ON pe.id = rf.refunded_by
    LEFT JOIN users u          ON u.id = pe.user_id
        WHERE rf.original_sale_id = $1
        ORDER BY rf.id`,
      [saleId],
    )
  ).rows;

  // This sale was the "new items" side of an exchange.
  const exchangeOf = (
    await pool.query<{ sale_id: number; sale_number: string }>(
      `SELECT s.id AS sale_id, s.sale_number
         FROM pos_refunds rf JOIN pos_sales s ON s.id = rf.original_sale_id
        WHERE rf.exchange_sale_id = $1
        LIMIT 1`,
      [saleId],
    )
  ).rows[0];

  let customer: SaleCustomer = null;
  if (sale.customer_id) {
    const c = (
      await pool.query<{
        id: number;
        name: string | null;
        email: string | null;
        phone: string | null;
        store_credit: string | null;
        orders: number;
        spent: string;
      }>(
        `SELECT c.id,
                NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), '') AS name,
                c.email, c.phone, c.store_credit_balance::text AS store_credit,
                (SELECT count(*) FROM pos_sales WHERE customer_id = c.id AND status IN ('completed','refunded'))::int AS orders,
                (SELECT COALESCE(sum(total_amount), 0) FROM pos_sales WHERE customer_id = c.id AND status IN ('completed','refunded'))::text AS spent
           FROM pos_customers c WHERE c.id = $1`,
        [sale.customer_id],
      )
    ).rows[0];
    if (c) {
      customer = {
        id: c.id,
        name: c.name ?? "",
        email: c.email,
        phone: c.phone,
        store_credit: Number(c.store_credit ?? 0),
        orders: c.orders,
        spent: Number(c.spent),
      };
    }
  }

  const tz = sale.timezone || "America/New_York";
  const at = (d: string | Date) =>
    new Date(d).toLocaleString("en-US", {
      timeZone: tz,
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const refundedTotal = refunds.reduce((a, r) => a + Number(r.amount), 0);
  const net = Math.round((Number(sale.total_amount) - refundedTotal) * 100) / 100;
  const piecesLeft = lines.reduce((a, l) => a + Math.max(0, l.quantity - l.returned_qty), 0);
  const returnable =
    (sale.status === "completed" || sale.status === "refunded") && piecesLeft > 0 && net > 0;
  const creditLocked =
    payments.some((p) => p.method === "store_credit") || refunds.some((r) => r.method === "store_credit");
  const itemCount = lines.reduce((a, l) => a + l.quantity, 0);

  return (
    <AdminShell email={cashier.email} active="sales" code={code} title={`Order ${sale.sale_number}`}>
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/sales/${code}`} className="text-sm text-[var(--color-pos-muted)] underline">
            ← Orders
          </Link>
          <h1 className="text-2xl font-bold mt-1">#{sale.sale_number}</h1>
          <p className="text-sm text-[var(--color-pos-muted)]">
            {at(sale.completed_at ?? sale.created_at)} · {sale.location_name} · {sale.register_name}
          </p>
          <p className="text-sm text-[var(--color-pos-muted)]">
            Cashier: {sale.cashier_name ?? sale.cashier_email}
            {sale.attributed_differs && sale.attributed_name ? ` · Sales associate: ${sale.attributed_name}` : ""}
            {sale.recorded_offline ? " · Rung up offline" : ""}
          </p>
          {exchangeOf && (
            <p className="text-sm mt-1">
              Exchange for{" "}
              <Link href={`/sales/${code}/${exchangeOf.sale_id}`} className="font-semibold text-carbon-blue underline">
                #{exchangeOf.sale_number}
              </Link>
            </p>
          )}
        </div>
        <div className="text-right">
          <span
            className={`inline-block px-3 py-1 text-xs font-semibold ${
              sale.status === "completed"
                ? refunds.length > 0
                  ? "bg-amber-50 text-amber-800"
                  : "bg-green-50 text-green-800"
                : sale.status === "refunded"
                  ? "bg-amber-50 text-amber-800"
                  : sale.status === "voided"
                    ? "bg-red-50 text-red-800"
                    : "bg-zinc-100 text-zinc-700"
            }`}
          >
            {sale.status === "completed" && refunds.length > 0 ? "partially returned" : sale.status}
          </span>
          <p className="text-3xl font-bold tabular-nums mt-2">{formatMoney(sale.total_amount)}</p>
          {refundedTotal > 0 && (
            <p className="text-sm text-carbon-text-muted tabular-nums">Net after returns {formatMoney(net)}</p>
          )}
        </div>
      </header>

      {sale.status === "voided" && (
        <div className="mx-6 mt-4 border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Voided {sale.voided_at ? at(sale.voided_at) : ""}
          {sale.voided_by_name ? ` by ${sale.voided_by_name}` : ""}
          {sale.void_reason ? ` — ${sale.void_reason}` : ""}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
        <section className="lg:col-span-2 min-w-0">
          <h2 className="font-semibold mb-2">
            Items <span className="text-carbon-text-muted font-normal">({itemCount})</span>
          </h2>
          <SaleLines code={code} lines={lines} />

          {refunds.length > 0 && (
            <>
              <h2 className="font-semibold mt-8 mb-2">Returns &amp; refunds</h2>
              <div className="overflow-auto">
                <table className="w-full text-sm border border-[var(--color-pos-border)]">
                  <thead className="bg-[var(--color-pos-bg)]">
                    <tr className="text-left">
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">By</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2 text-right">Items</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {refunds.map((r) => (
                      <tr key={r.id} className="border-t border-[var(--color-pos-border)]">
                        <td className="px-3 py-2 whitespace-nowrap">{at(r.created_at)}</td>
                        <td className="px-3 py-2">
                          {r.exchange_sale_id ? (
                            <>
                              Exchange →{" "}
                              <Link href={`/sales/${code}/${r.exchange_sale_id}`} className="text-carbon-blue underline">
                                #{r.exchange_number}
                              </Link>
                            </>
                          ) : (
                            <>Refund · {REFUND_LABEL[r.method] ?? r.method}</>
                          )}
                          {r.override_by && (
                            <span className="block text-xs text-carbon-text-muted">Approved: {r.override_by}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{r.by_name ?? "—"}</td>
                        <td className="px-3 py-2">{r.reason ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{r.pieces || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">−{formatMoney(r.amount)}</td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/sales/${code}/refund/receipt?refund=${r.id}&back=${encodeURIComponent(`/sales/${code}/${saleId}`)}`}
                            className="text-carbon-blue underline whitespace-nowrap"
                          >
                            Receipt
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {sale.notes && (
            <div className="mt-8 border border-[var(--color-pos-border)] p-4">
              <h2 className="font-semibold mb-1">Notes</h2>
              <p className="text-sm whitespace-pre-line">{sale.notes}</p>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <SaleReturnActions code={code} saleNumber={sale.sale_number} returnable={returnable} />

          <SaleCustomerCard code={code} saleId={sale.id} customer={customer} locked={creditLocked} />

          <SaleActions saleId={sale.id} code={code} defaultEmail={customer?.email ?? null} />

          <div className="bg-white border border-[var(--color-pos-border)] p-4">
            <h2 className="font-semibold mb-2">Totals</h2>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-[var(--color-pos-muted)]">Subtotal</dt>
              <dd className="text-right tabular-nums">{formatMoney(sale.subtotal)}</dd>
              {Number(sale.discount_amount) > 0 && (
                <>
                  <dt className="text-[var(--color-pos-muted)]">Discount</dt>
                  <dd className="text-right tabular-nums">−{formatMoney(sale.discount_amount)}</dd>
                </>
              )}
              <dt className="text-[var(--color-pos-muted)]">Tax</dt>
              <dd className="text-right tabular-nums">{formatMoney(sale.tax_amount)}</dd>
              <dt className="font-bold text-base">Total</dt>
              <dd className="text-right font-bold text-base tabular-nums">{formatMoney(sale.total_amount)}</dd>
              {refundedTotal > 0 && (
                <>
                  <dt className="text-[var(--color-pos-muted)]">Returned</dt>
                  <dd className="text-right tabular-nums">−{formatMoney(refundedTotal)}</dd>
                  <dt className="font-semibold">Net</dt>
                  <dd className="text-right font-semibold tabular-nums">{formatMoney(net)}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="bg-white border border-[var(--color-pos-border)] p-4">
            <h2 className="font-semibold mb-2">Payments</h2>
            {payments.length === 0 ? (
              <p className="text-sm text-[var(--color-pos-muted)]">No payments recorded.</p>
            ) : (
              <ul className="text-sm">
                {payments.map((p, i) => (
                  <li
                    key={p.id}
                    className="flex justify-between py-1 border-b border-[var(--color-pos-border)] last:border-b-0"
                  >
                    <span>
                      <span className="font-medium">{payLabels[i]}</span>
                      {p.method === "cash" && p.cash_given && (
                        <span className="text-xs text-[var(--color-pos-muted)] ml-2">
                          (got {formatMoney(p.cash_given)} · change {formatMoney(p.change_given ?? 0)})
                        </span>
                      )}
                      {p.reference && (
                        <span className="text-xs text-[var(--color-pos-muted)] ml-2">{p.reference}</span>
                      )}
                      {p.status !== "completed" && (
                        <span className="text-xs text-amber-800 ml-2">{p.status}</span>
                      )}
                    </span>
                    <span className="font-medium tabular-nums">{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </AdminShell>
  );
}
