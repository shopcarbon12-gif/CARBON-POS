import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { ReportShell } from "@/components/admin/ReportShell";

export default async function EndOfDayReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/reports/end-of-day");
  }
  const sp = await searchParams;
  const date = sp.date || new Date().toISOString().slice(0, 10);
  const pool = getPool();
  const [totals, byMethod, byRegister] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS tx_count,
              COALESCE(SUM(s.subtotal),0)        AS subtotal,
              COALESCE(SUM(s.discount_amount),0) AS discount,
              COALESCE(SUM(s.tax_amount),0)      AS tax,
              COALESCE(SUM(s.total_amount),0)    AS total
         FROM pos_sales s
        WHERE s.status = 'completed'
          AND s.completed_at::date = $1`,
      [date],
    ),
    pool.query(
      `SELECT p.method,
              COALESCE(SUM(p.amount),0) AS amount,
              COUNT(*) AS count
         FROM pos_payments p
         JOIN pos_sales s ON s.id = p.sale_id
        WHERE s.status = 'completed'
          AND s.completed_at::date = $1
          AND p.status = 'completed'
        GROUP BY p.method
        ORDER BY p.method`,
      [date],
    ),
    pool.query(
      `SELECT s.register_id,
              r.name AS register_name,
              COUNT(*) AS tx_count,
              COALESCE(SUM(s.total_amount),0) AS total
         FROM pos_sales s
         JOIN pos_registers r ON r.id = s.register_id
        WHERE s.status = 'completed'
          AND s.completed_at::date = $1
        GROUP BY s.register_id, r.name
        ORDER BY r.name`,
      [date],
    ),
  ]);
  const t = totals.rows[0];
  return (
    <ReportShell
      title="End of Day"
      description="One day's totals at a glance."
      filters={
        <form className="flex gap-3 items-end">
          <label className="text-xs font-medium">
            <span className="block mb-1">Date</span>
            <input
              type="date"
              name="date"
              defaultValue={date}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
            />
          </label>
          <button
            type="submit"
            className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-4"
          >
            Run report
          </button>
        </form>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <Stat label="Transactions" value={String(t.tx_count)} />
        <Stat label="Subtotal" value={formatMoney(t.subtotal)} />
        <Stat label="Discounts" value={formatMoney(t.discount)} />
        <Stat label="Tax" value={formatMoney(t.tax)} />
        <Stat label="Revenue" value={formatMoney(t.total)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ReportTable
          title="By payment method"
          headers={["Method", "Count", "Amount"]}
          rows={byMethod.rows.map((r) => [
            humanMethod(r.method),
            String(r.count),
            formatMoney(r.amount),
          ])}
        />
        <ReportTable
          title="By register"
          headers={["Register", "Sales", "Total"]}
          rows={byRegister.rows.map((r) => [
            r.register_name,
            String(r.tx_count),
            formatMoney(r.total),
          ])}
        />
      </div>
    </ReportShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
      <p className="text-xs text-[var(--color-pos-muted)]">{label}</p>
      <p className="total-display text-2xl mt-1">{value}</p>
    </div>
  );
}

function ReportTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <div>
      <h2 className="font-semibold mb-2">{title}</h2>
      <table className="w-full text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
        <thead className="bg-[var(--color-pos-bg)]">
          <tr className="text-left">
            {headers.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2 ${
                  i === headers.length - 1 ? "text-right" : ""
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={headers.length}
                className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
              >
                Nothing recorded for this day.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr
                key={i}
                className="border-t border-[var(--color-pos-border)]"
              >
                {r.map((c, j) => (
                  <td
                    key={j}
                    className={`px-3 py-2 ${
                      j === r.length - 1 ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function humanMethod(m: string): string {
  return (
    {
      card: "Card",
      cash: "Cash",
      check: "Check",
      store_credit: "Store credit",
    }[m] ?? m
  );
}
