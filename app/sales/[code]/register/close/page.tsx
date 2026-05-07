import Link from "next/link";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { CloseRegisterClient } from "./CloseRegisterClient";

/**
 * Close Register page. Layout follows the supplied screenshot:
 *
 *   Register - "<name>" Closing Totals
 *   ┌──────────┬───────────┬──────────┬──────────┬─────────────┬──────────────┐
 *   │   Type   │ Start+Adds│ Payments │ Withdraws│ Total Rem.  │ Closing Count │
 *   ├──────────┼───────────┼──────────┼──────────┼─────────────┼──────────────┤
 *   │ Cash     │   ...     │  ...     │  ...     │  expected   │  bills × $   │
 *   │ Credit … │           │          │          │             │  $ input     │
 *   └──────────┴───────────┴──────────┴──────────┴─────────────┴──────────────┘
 *   Notes
 *   [ Submit Counts ] [ Cancel ] [ Open Drawer ]
 *
 * Per spec we OMIT: Adjustment, CHECK, eCom (any). Cash denomination
 * breakdown excludes cents and the Extra row.
 *
 * Server-side computes Start+Adds / Payments / Withdraws / Total Remaining
 * for each method from pos_payments + pos_cash_movements; the client
 * collects the cashier's counts and POSTs to the existing close endpoint.
 */
export default async function CloseRegisterPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "sales",
    from: `/sales/${code}/register/close`,
  });

  const pool = getPool();
  // Find the cashier's open session at this location.
  const sessionR = await pool.query(
    `SELECT s.id           AS session_id,
            s.opening_cash,
            s.opened_at,
            r.id           AS register_id,
            r.name         AS register_name,
            l.name         AS location_name
       FROM pos_register_sessions s
       JOIN pos_registers   r  ON r.id = s.register_id
       JOIN pos_locations   pl ON pl.id = r.pos_location_id
       JOIN locations       l  ON l.id = pl.wms_location_id
      WHERE s.opened_by = $1::uuid
        AND s.status = 'open'
        AND pl.wms_location_id = $2::uuid
      ORDER BY s.opened_at DESC
      LIMIT 1`,
    [cashier.user_id, cashier.lid],
  );
  const session = sessionR.rows[0];
  if (!session) {
    redirect(`/sales/${code}/register`);
  }

  // Per-method totals during this session window.
  const [paymentsR, movementsR] = await Promise.all([
    pool.query<{ method: string; total: string }>(
      `SELECT p.method, COALESCE(SUM(p.amount), 0)::text AS total
         FROM pos_payments p
         JOIN pos_sales s ON s.id = p.sale_id
        WHERE s.register_id = $1::int
          AND s.created_at >= $2::timestamptz
          AND p.status = 'completed'
        GROUP BY p.method`,
      [session.register_id, session.opened_at],
    ),
    pool.query<{ drops: string; payouts: string; adds: string }>(
      `SELECT COALESCE(SUM(CASE WHEN type = 'drop'   THEN amount ELSE 0 END), 0)::text AS drops,
              COALESCE(SUM(CASE WHEN type = 'payout' THEN amount ELSE 0 END), 0)::text AS payouts,
              COALESCE(SUM(CASE WHEN type = 'add'    THEN amount ELSE 0 END), 0)::text AS adds
         FROM pos_cash_movements
        WHERE register_session_id = $1::int`,
      [session.session_id],
    ),
  ]);

  const paymentBy = new Map<string, number>();
  for (const r of paymentsR.rows) paymentBy.set(r.method, Number(r.total));
  const drops = Number(movementsR.rows[0]?.drops ?? 0);
  const payouts = Number(movementsR.rows[0]?.payouts ?? 0);
  const adds = Number(movementsR.rows[0]?.adds ?? 0);

  const opening = Number(session.opening_cash);
  const cashPayments = paymentBy.get("cash") ?? 0;
  // Drops and payouts both remove cash from the drawer; adds put cash in.
  const cashStartAdds = opening + adds;
  const cashWithdraws = drops + payouts;
  const cashExpected = cashStartAdds + cashPayments - cashWithdraws;

  const cardPayments = paymentBy.get("card") ?? 0;

  const rows = [
    {
      key: "cash",
      label: "Cash",
      startAdds: cashStartAdds,
      payments: cashPayments,
      withdraws: cashWithdraws,
      remaining: cashExpected,
      kind: "cash" as const,
    },
    {
      key: "credit_card",
      label: "Credit Card",
      startAdds: 0,
      payments: cardPayments,
      withdraws: 0,
      remaining: cardPayments,
      kind: "amount" as const,
    },
    {
      key: "debit_card",
      label: "Debit Card",
      startAdds: 0,
      payments: 0,
      withdraws: 0,
      remaining: 0,
      kind: "amount" as const,
    },
    {
      key: "credit_account",
      label: "Credit Account",
      startAdds: 0,
      payments: 0,
      withdraws: 0,
      remaining: 0,
      kind: "readonly" as const,
    },
    {
      key: "gift_card",
      label: "Gift Card",
      startAdds: 0,
      payments: 0,
      withdraws: 0,
      remaining: 0,
      kind: "readonly" as const,
    },
  ];

  return (
    <AdminShell
      email={cashier.email}
      active="sales"
      code={code}
      title="Close Register"
    >
      <section className="p-6 max-w-7xl">
        <Link
          href={`/sales/${code}`}
          className="text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
        >
          ← Back to Sales
        </Link>
        <h1 className="text-xl font-bold mt-2 mb-1">
          Register - &quot;{session.register_name}&quot; Closing Totals
        </h1>
        <p className="text-sm text-carbon-text-muted mb-6">
          Counting cash and other payment totals at{" "}
          <span className="font-semibold text-carbon-text">
            {session.location_name}
          </span>
          . Submit when the drawer is reconciled.
        </p>

        <CloseRegisterClient
          sessionId={Number(session.session_id)}
          code={code}
          rows={rows}
        />
      </section>
    </AdminShell>
  );
}
