import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { formatMoney } from "@/lib/utils";
import { storeToday } from "@/lib/reports";
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
  const pool = getPool();
  const locR = await pool.query(
    `SELECT id, COALESCE(timezone, 'America/New_York') AS tz
       FROM pos_locations WHERE wms_location_id = $1::uuid LIMIT 1`,
    [cashier.lid],
  );
  const posLocationId: number | null = locR.rows[0]?.id ?? null;
  const tz: string = locR.rows[0]?.tz ?? "America/New_York";
  const today = storeToday(tz);
  const from = sp.from || today;
  const to = sp.to || today;
  // all | completed | refunded | voided | refunds (refund rows only)
  const status = sp.status ?? "all";
  const registerId = sp.register_id ? Number(sp.register_id) : null;
  const cashierId = sp.cashier_id ? Number(sp.cashier_id) : null;
  const q = (sp.q ?? "").trim();
  const showSales = status !== "refunds";
  const showRefunds = status === "all" || status === "refunds";

  // ---- sales (store-local days) ----
  const conds: string[] = [];
  const args: unknown[] = [];
  conds.push(`s.pos_location_id = $${args.push(posLocationId)}`);
  conds.push(
    `(COALESCE(s.completed_at, s.created_at) AT TIME ZONE $${args.push(tz)})::date BETWEEN $${args.push(from)}::date AND $${args.push(to)}::date`,
  );
  if (status === "completed" || status === "refunded" || status === "voided") {
    conds.push(`s.status = $${args.push(status)}`);
  } else {
    conds.push(`s.status IN ('completed','refunded','voided')`);
  }
  if (registerId) conds.push(`s.register_id = $${args.push(registerId)}`);
  if (cashierId) conds.push(`s.cashier_id = $${args.push(cashierId)}`);
  if (q) {
    const idx = args.push(`%${q}%`);
    conds.push(
      `(s.sale_number ILIKE $${idx} OR c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx})`,
    );
  }

  // ---- refunds (by the day the refund was made) ----
  const rconds: string[] = [];
  const rargs: unknown[] = [];
  rconds.push(`s.pos_location_id = $${rargs.push(posLocationId)}`);
  rconds.push(
    `(rf.created_at AT TIME ZONE $${rargs.push(tz)})::date BETWEEN $${rargs.push(from)}::date AND $${rargs.push(to)}::date`,
  );
  if (registerId) rconds.push(`COALESCE(rs.register_id, s.register_id) = $${rargs.push(registerId)}`);
  if (cashierId) rconds.push(`rf.refunded_by = $${rargs.push(cashierId)}`);
  if (q) {
    const idx = rargs.push(`%${q}%`);
    rconds.push(
      `(s.sale_number ILIKE $${idx} OR c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx}
        OR ('R' || lpad(rf.id::text, 6, '0')) ILIKE $${idx})`,
    );
  }

  const name = (a: string) =>
    `COALESCE(NULLIF(TRIM(COALESCE(${a}.first_name,'') || ' ' || COALESCE(${a}.last_name,'')), ''), ${a}.email)`;

  const [rows, refundRows, registers, cashiers, totalsRes, refundTotalsRes, openSession] = await Promise.all([
    showSales
      ? pool.query(
          `SELECT s.id, s.sale_number, s.total_amount, s.tax_amount, s.discount_amount,
                  s.status, s.created_at, s.completed_at,
                  r.name AS register_name,
                  ${name("u")} AS cashier_name,
                  c.first_name, c.last_name
             FROM pos_sales s
             JOIN pos_registers r  ON r.id = s.register_id
             JOIN pos_employees pe ON pe.id = s.cashier_id
             JOIN users u          ON u.id = pe.user_id
             LEFT JOIN pos_customers c ON c.id = s.customer_id
            WHERE ${conds.join(" AND ")}
            ORDER BY COALESCE(s.completed_at, s.created_at) DESC
            LIMIT 200`,
          args,
        )
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    showRefunds
      ? pool.query(
          `SELECT rf.id, rf.amount, rf.method, rf.reason, rf.created_at,
                  s.id AS sale_id, s.sale_number,
                  COALESCE(rr.name, r0.name) AS register_name,
                  ${name("u")} AS cashier_name,
                  c.first_name, c.last_name
             FROM pos_refunds rf
             JOIN pos_sales s           ON s.id = rf.original_sale_id
             JOIN pos_registers r0      ON r0.id = s.register_id
             LEFT JOIN pos_register_sessions rs ON rs.id = rf.register_session_id
             LEFT JOIN pos_registers rr ON rr.id = rs.register_id
             LEFT JOIN pos_employees pe ON pe.id = rf.refunded_by
             LEFT JOIN users u          ON u.id = pe.user_id
             LEFT JOIN pos_customers c  ON c.id = s.customer_id
            WHERE ${rconds.join(" AND ")}
            ORDER BY rf.created_at DESC
            LIMIT 200`,
          rargs,
        )
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    pool.query(
      `SELECT r.id, r.name
         FROM pos_registers r
        WHERE r.is_active = TRUE
          AND r.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid)
        ORDER BY r.name`,
      [cashier.lid],
    ),
    pool.query(
      `SELECT pe.id, ${name("u")} AS name
         FROM pos_employees pe
         JOIN users u ON u.id = pe.user_id
        WHERE pe.is_active = TRUE
        ORDER BY 2`,
    ),
    // Sales totals — voided sales never count toward revenue.
    showSales
      ? pool.query(
          `SELECT COUNT(*) FILTER (WHERE s.status <> 'voided')                         AS tx_count,
                  COALESCE(SUM(s.total_amount)    FILTER (WHERE s.status <> 'voided'),0) AS revenue,
                  COALESCE(SUM(s.tax_amount)      FILTER (WHERE s.status <> 'voided'),0) AS tax,
                  COALESCE(SUM(s.discount_amount) FILTER (WHERE s.status <> 'voided'),0) AS discount
             FROM pos_sales s
             LEFT JOIN pos_customers c ON c.id = s.customer_id
            WHERE ${conds.join(" AND ")}`,
          args,
        )
      : Promise.resolve({ rows: [{ tx_count: 0, revenue: 0, tax: 0, discount: 0 }] }),
    showRefunds
      ? pool.query(
          `SELECT COUNT(*) AS cnt,
                  COALESCE(SUM(rf.amount),0) AS amount,
                  COALESCE(SUM(rf.tax_amount),0) AS tax
             FROM pos_refunds rf
             JOIN pos_sales s           ON s.id = rf.original_sale_id
             LEFT JOIN pos_register_sessions rs ON rs.id = rf.register_session_id
             LEFT JOIN pos_customers c  ON c.id = s.customer_id
            WHERE ${rconds.join(" AND ")}`,
          rargs,
        )
      : Promise.resolve({ rows: [{ cnt: 0, amount: 0, tax: 0 }] }),
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
  const refundTotals = refundTotalsRes.rows[0];
  const refundAmount = Number(refundTotals.amount ?? 0);
  const netRevenue = Number(totals.revenue ?? 0) - refundAmount;
  const netTax = Number(totals.tax ?? 0) - Number(refundTotals.tax ?? 0);

  type ListRow = {
    key: string;
    kind: "sale" | "refund";
    href: string;
    number: string;
    sub: string | null;
    at: Date;
    register: string;
    cashier: string;
    customer: string;
    status: string;
    amount: number;
  };
  const customerOf = (r: Record<string, unknown>) =>
    [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
  const REFUND_TO: Record<string, string> = {
    original_card: "to card",
    cash: "cash",
    store_credit: "store credit",
  };
  const list: ListRow[] = [
    ...rows.rows.map((r) => ({
      key: `s${r.id}`,
      kind: "sale" as const,
      href: `/sales/${code}/${r.id}`,
      number: String(r.sale_number),
      sub: null,
      at: new Date((r.completed_at ?? r.created_at) as string),
      register: String(r.register_name),
      cashier: String(r.cashier_name ?? ""),
      customer: customerOf(r),
      status: String(r.status),
      amount: Number(r.total_amount),
    })),
    ...refundRows.rows.map((r) => ({
      key: `r${r.id}`,
      kind: "refund" as const,
      href: `/sales/${code}/refund/receipt?refund=${r.id}&back=${encodeURIComponent(`/sales/${code}`)}`,
      number: `R${String(r.id).padStart(6, "0")}`,
      sub: `for ${r.sale_number}`,
      at: new Date(r.created_at as string),
      register: String(r.register_name),
      cashier: String(r.cashier_name ?? ""),
      customer: customerOf(r),
      status: `refund · ${REFUND_TO[String(r.method)] ?? r.method}`,
      amount: -Number(r.amount),
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 200);
  const fmtWhen = (d: Date) =>
    d.toLocaleString("en-US", {
      timeZone: tz,
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
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
      <section className="p-3 sm:p-6">
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
                  {c.name}
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
              <option value="refunds">Refunds only</option>
            </select>
          </Field>
          <Field label="Search">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Receipt #, R# or customer"
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

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          <Stat label="Sales" value={String(totals.tx_count)} />
          <Stat
            label={`Refunds (${refundTotals.cnt})`}
            value={refundAmount > 0 ? `-${formatMoney(refundAmount)}` : formatMoney(0)}
            danger={refundAmount > 0}
          />
          <Stat label="Net revenue" value={formatMoney(netRevenue)} />
          <Stat label="Tax (net)" value={formatMoney(netTax)} />
          <Stat label="Discounts" value={formatMoney(totals.discount)} />
        </div>

        <table className="w-full text-sm border border-[var(--color-pos-border)] overflow-hidden">
          <thead className="bg-[var(--color-pos-bg)]">
            <tr className="text-left">
              <th className="px-3 py-2">Receipt</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Register</th>
              <th className="px-3 py-2">Cashier</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
                >
                  No sales or refunds match your filters.
                </td>
              </tr>
            ) : (
              list.map((r) => (
                <tr
                  key={r.key}
                  className={`border-t border-[var(--color-pos-border)] ${
                    r.kind === "refund" ? "bg-red-50" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={r.href}
                      className={`font-semibold hover:underline ${
                        r.kind === "refund" ? "text-carbon-danger" : "text-carbon-blue"
                      }`}
                    >
                      {r.number}
                    </Link>
                    {r.sub && (
                      <span className="block text-xs text-[var(--color-pos-muted)]">
                        {r.sub}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{fmtWhen(r.at)}</td>
                  <td className="px-3 py-2">{r.register}</td>
                  <td className="px-3 py-2">{r.cashier}</td>
                  <td className="px-3 py-2">{r.customer}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        r.kind === "refund"
                          ? "text-carbon-danger font-semibold"
                          : r.status === "voided"
                            ? "text-[var(--color-pos-muted)] line-through"
                            : ""
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-medium tabular-nums ${
                      r.kind === "refund" ? "text-carbon-danger" : ""
                    } ${r.status === "voided" ? "line-through text-[var(--color-pos-muted)]" : ""}`}
                  >
                    {r.amount < 0 ? `-${formatMoney(-r.amount)}` : formatMoney(r.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--color-pos-ink)] font-bold bg-[var(--color-pos-bg)]">
                <td className="px-3 py-2" colSpan={6}>
                  Net revenue (sales − refunds, voids excluded)
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(netRevenue)}</td>
              </tr>
            </tfoot>
          )}
        </table>

        <p className="text-xs text-[var(--color-pos-muted)] mt-2">
          Showing the most recent {list.length} sales and refunds (capped at
          200). Use tighter filters or the Reports tab for date-range CSV
          exports.
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

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="bg-white border border-[var(--color-pos-border)] p-4">
      <p className="text-xs text-[var(--color-pos-muted)]">{label}</p>
      <p className={`total-display text-3xl mt-1 ${danger ? "text-carbon-danger" : ""}`}>
        {value}
      </p>
    </div>
  );
}
