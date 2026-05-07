import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { AdminShell } from "@/components/admin/AdminShell";
import { RegisterActionsClient } from "@/components/sales/RegisterActionsClient";
import { OpenRegisterButton } from "@/components/sales/OpenRegisterButton";

type Search = {
  from?: string;
  to?: string;
  register_id?: string;
  cashier_id?: string;
  status?: string;
  q?: string;
};

/**
 * Sales tab. Top of the page shows the action button rail (gated on whether
 * the cashier currently has an open register session) and the rest is the
 * sales-history table with date / register / cashier / status filters.
 *
 * Button rail visibility:
 *   - register OPEN  →  [ New Sale ] [ Exchange ] [ Refund ] [ Lookup ]
 *   - register CLOSED →  [ Open Register ] [ Lookup ]
 */
export default async function SalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Search>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "sales",
    from: `/sales/${code}`,
  });
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
  // Active-location scope.
  args.push(cashier.lid);
  const lidIdx = args.length;
  conds.push(`s.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $${lidIdx}::uuid)`);

  const [rows, registers, cashiers, totalsRes, openSession] = await Promise.all([
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
      `SELECT r.id, r.name
         FROM pos_registers r
        WHERE r.is_active = TRUE
          AND r.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid)
        ORDER BY r.name`,
      [cashier.lid],
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
    // Does *this cashier* currently have a register session open at this
    // location? Drives the button-rail gating. We pull the location's
    // human-readable name in the same round-trip so the "Current register"
    // header can read "Register 1 at Elementi Florida Mall".
    pool.query(
      `SELECT s.id,
              r.name AS register_name,
              l.name AS location_name
         FROM pos_register_sessions s
         JOIN pos_registers r ON r.id = s.register_id
         JOIN pos_locations pl ON pl.id = r.pos_location_id
         JOIN locations l      ON l.id  = pl.wms_location_id
        WHERE s.opened_by = $1::uuid
          AND s.status = 'open'
          AND pl.wms_location_id = $2::uuid
        LIMIT 1`,
      [cashier.user_id, cashier.lid],
    ),
  ]);
  const totals = totalsRes.rows[0];
  const isRegisterOpen = (openSession.rowCount ?? 0) > 0;
  const openRegisterName = openSession.rows[0]?.register_name as
    | string
    | undefined;
  const openLocationName = openSession.rows[0]?.location_name as
    | string
    | undefined;
  const openSessionId = openSession.rows[0]?.id as number | undefined;
  // How many active registers exist at this location? Drives whether
  // "Switch Register" is enabled (only useful when there are 2+).
  const registerCount = registers.rows.length;

  return (
    <AdminShell email={cashier.email} active="sales" code={code}>
      <section className="p-6">
        {/* ───── Section 1 — Current sale ─────
            New Sale / Exchange / Refund / Lookup when a register is open;
            Open Register / Lookup when none is. */}
        <div className="mb-8">
          <h2 className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted mb-3">
            Current sale
          </h2>
          {isRegisterOpen ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ActionButton
                href={`/sales/${code}/new`}
                label="New Sale"
                icon="point_of_sale"
                primary
              />
              <ActionButton
                href={`/sales/${code}/exchange`}
                label="Exchange"
                icon="swap_horiz"
              />
              <ActionButton
                href={`/sales/${code}/refund`}
                label="Refund"
                icon="assignment_return"
              />
              <ActionButton
                href={`/sales/${code}/lookup`}
                label="Lookup"
                icon="search"
              />
            </div>
          ) : (
            <>
              <p className="text-sm text-carbon-text-muted mb-3">
                Open a register to start a sale.
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <OpenRegisterButton code={code} />
                <ActionButton
                  href={`/sales/${code}/lookup`}
                  label="Lookup"
                  icon="search"
                />
              </div>
            </>
          )}
        </div>

        {/* ───── Section 2 — Current register (only shown when one is open) ───── */}
        {isRegisterOpen ? (
          <div className="mb-8">
            <h2 className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted mb-1">
              Current register is &quot;{openRegisterName}&quot;
            </h2>
            <p className="text-sm text-carbon-text-muted mb-3 max-w-3xl">
              The register is where you do sales and refunds. You are
              currently using{" "}
              <span className="font-semibold text-carbon-text">
                &quot;{openRegisterName}&quot;
              </span>{" "}
              at{" "}
              <span className="font-semibold text-carbon-text">
                &quot;{openLocationName ?? code}&quot;
              </span>
              .
            </p>
            <RegisterActionsClient
              code={code}
              sessionId={Number(openSessionId)}
              registerCount={registerCount}
            />
          </div>
        ) : null}

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
            className="tap col-span-2 sm:col-span-6 carbon-btn-primary font-semibold"
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

        <table className="w-full text-sm border border-[var(--color-pos-border)] overflow-hidden">
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
                    <Link href={`/sales/${code}/${s.id}`}>{s.sale_number}</Link>
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

function ActionButton({
  href,
  label,
  icon,
  primary,
}: {
  href: string;
  label: string;
  icon: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`tap-lg flex items-center justify-center gap-2 px-4 ${
        primary ? "carbon-btn-primary" : "carbon-btn-secondary"
      }`}
    >
      <span className="material-symbols-outlined">{icon}</span>
      <span className="font-semibold">{label}</span>
    </Link>
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
    <div className="bg-white border border-[var(--color-pos-border)] p-4">
      <p className="text-xs text-[var(--color-pos-muted)]">{label}</p>
      <p className="total-display text-3xl mt-1">{value}</p>
    </div>
  );
}
