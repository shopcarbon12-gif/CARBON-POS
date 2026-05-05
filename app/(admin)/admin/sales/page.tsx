import Link from "next/link";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { AdminShell } from "@/components/admin/AdminShell";

type Search = {
  from?: string;
  to?: string;
  register_id?: string;
  cashier_id?: string;
  status?: string;
  q?: string;
};

/**
 * Sales history with date / register / cashier / status / sale-number filters.
 * Server component — filters are query params so the URL is shareable.
 */
export default async function AdminSalesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/sales");
  }
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from || today;
  const to = sp.to || today;
  const status = sp.status ?? "all";
  const registerId = sp.register_id ? Number(sp.register_id) : null;
  const cashierId = sp.cashier_id ? Number(sp.cashier_id) : null;
  const q = (sp.q ?? "").trim();

  const pool = getPool();
  const conds: string[] = [];
  const args: unknown[] = [];
  conds.push(`s.created_at::date BETWEEN $${args.push(from)} AND $${args.push(to)}`);
  if (status !== "all") {
    conds.push(`s.status = $${args.push(status)}`);
  } else {
    conds.push(`s.status IN ('completed','refunded','voided')`);
  }
  if (registerId) conds.push(`s.register_id = $${args.push(registerId)}`);
  if (cashierId) conds.push(`s.cashier_id = $${args.push(cashierId)}`);
  if (q) {
    args.push(`%${q}%`);
    const idx = args.length;
    conds.push(
      `(s.sale_number ILIKE $${idx} OR c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx})`,
    );
  }

  const [rows, registers, cashiers, totalsRes] = await Promise.all([
    pool.query(
      `SELECT s.id, s.sale_number, s.total_amount, s.tax_amount, s.discount_amount,
              s.status, s.created_at, s.completed_at,
              r.name AS register_name,
              u.email AS cashier_email,
              c.first_name, c.last_name
         FROM pos_sales s
         JOIN pos_registers r  ON r.id = s.register_id
         JOIN pos_employees pe ON pe.id = s.cashier_id
         JOIN users u          ON u.id = pe.user_id
         LEFT JOIN pos_customers c ON c.id = s.customer_id
        WHERE ${conds.join(" AND ")}
        ORDER BY s.completed_at DESC NULLS LAST, s.created_at DESC
        LIMIT 200`,
      args,
    ),
    pool.query(
      `SELECT id, name FROM pos_registers WHERE is_active = TRUE ORDER BY name`,
    ),
    pool.query(
      `SELECT pe.id, u.email
         FROM pos_employees pe
         JOIN users u ON u.id = pe.user_id
        WHERE pe.is_active = TRUE
        ORDER BY u.email`,
    ),
    pool.query(
      `SELECT COUNT(*) AS tx_count,
              COALESCE(SUM(s.total_amount),0)    AS revenue,
              COALESCE(SUM(s.tax_amount),0)      AS tax,
              COALESCE(SUM(s.discount_amount),0) AS discount
         FROM pos_sales s
         LEFT JOIN pos_customers c ON c.id = s.customer_id
        WHERE ${conds.join(" AND ")}`,
      args,
    ),
  ]);
  const totals = totalsRes.rows[0];

  return (
    <AdminShell email={cashier.email} active="sales">
      <section className="p-6">
        <form className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-5 items-end">
          <Field label="From">
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-2 w-full"
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-2 w-full"
            />
          </Field>
          <Field label="Register">
            <select
              name="register_id"
              defaultValue={sp.register_id ?? ""}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-2 w-full"
            >
              <option value="">All</option>
              {registers.rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cashier">
            <select
              name="cashier_id"
              defaultValue={sp.cashier_id ?? ""}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-2 w-full"
            >
              <option value="">All</option>
              {cashiers.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              name="status"
              defaultValue={status}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-2 w-full"
            >
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="refunded">Refunded</option>
              <option value="voided">Voided</option>
            </select>
          </Field>
          <Field label="Search">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="POS-… or customer"
              className="tap rounded-lg border border-[var(--color-pos-border)] px-2 w-full"
            />
          </Field>
          <button
            type="submit"
            className="tap col-span-2 sm:col-span-6 rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold"
          >
            Apply filters
          </button>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <Stat label="Sales" value={String(totals.tx_count)} />
          <Stat label="Revenue" value={formatMoney(totals.revenue)} />
          <Stat label="Tax" value={formatMoney(totals.tax)} />
          <Stat label="Discounts" value={formatMoney(totals.discount)} />
        </div>

        <table className="w-full text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
          <thead className="bg-[var(--color-pos-bg)]">
            <tr className="text-left">
              <th className="px-3 py-2">Sale</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Register</th>
              <th className="px-3 py-2">Cashier</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
                >
                  No sales match your filters.
                </td>
              </tr>
            ) : (
              rows.rows.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-[var(--color-pos-border)]"
                >
                  <td className="px-3 py-2">
                    <Link href={`/admin/sales/${s.id}`}>{s.sale_number}</Link>
                  </td>
                  <td className="px-3 py-2">
                    {new Date(s.completed_at ?? s.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{s.register_name}</td>
                  <td className="px-3 py-2">{s.cashier_email}</td>
                  <td className="px-3 py-2">
                    {[s.first_name, s.last_name].filter(Boolean).join(" ") ||
                      "—"}
                  </td>
                  <td className="px-3 py-2">{s.status}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(s.total_amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <p className="text-xs text-[var(--color-pos-muted)] mt-2">
          Showing the most recent {rows.rows.length} sales (capped at 200). Use
          tighter filters or the Reports tab for date-range CSV exports.
        </p>
      </section>
    </AdminShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-xs font-medium text-[var(--color-pos-muted)]">
      <span className="block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
      <p className="text-xs text-[var(--color-pos-muted)]">{label}</p>
      <p className="total-display text-3xl mt-1">{value}</p>
    </div>
  );
}
