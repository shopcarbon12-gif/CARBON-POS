import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { SellScreenWrapper } from "./SellScreenWrapper";

/**
 * Server-side gate: a cashier can only reach the sell screen if they
 * already have an open register session. Otherwise we bounce them to the
 * register picker.
 */
export default async function PosHomePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "sales",
    from: `/sales/${code}/new`,
  });

  const pool = getPool();
  const r = await pool.query(
    `SELECT s.id            AS session_id,
            s.register_id,
            r.name          AS register_name,
            pl.tax_rate
       FROM pos_register_sessions s
       JOIN pos_registers   r  ON r.id = s.register_id
       JOIN pos_locations   pl ON pl.id = r.pos_location_id
      WHERE s.status = 'open'
        AND s.opened_by = $1
      ORDER BY s.opened_at DESC
      LIMIT 1`,
    [cashier.user_id],
  );
  const row = r.rows[0];
  if (!row) {
    redirect(`/sales/${code}/register`);
  }
  return (
    <SellScreenWrapper
      taxRate={Number(row.tax_rate)}
      registerName={row.register_name}
    />
  );
}
