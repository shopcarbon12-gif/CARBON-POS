import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { SellScreenWrapper } from "./SellScreenWrapper";

/**
 * Point of Sale screen. Wraps the sell screen in the back-office shell so
 * the cashier keeps the sidebar (Dashboard / Sales / Reports / etc.) and
 * the topbar visible while ringing up a sale — matches the
 * carbon_sales_interface_active_cart_light reference.
 *
 * Server-side gate: if the cashier doesn't have an open register session
 * yet, bounce them to /sales/{code}/register.
 */
export default async function PosHomePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "pos",
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
        AND s.opened_by = $1::uuid
        AND r.pos_location_id IN (SELECT id FROM pos_locations WHERE wms_location_id = $2::uuid)
      ORDER BY s.opened_at DESC
      LIMIT 1`,
    [cashier.user_id, cashier.lid],
  );
  const row = r.rows[0];
  if (!row) {
    redirect(`/sales/${code}/register`);
  }
  return (
    <AdminShell
      email={cashier.email}
      active="pos"
      code={code}
      title={`Point of Sale · ${code}`}
    >
      <SellScreenWrapper
        taxRate={Number(row.tax_rate)}
        registerName={row.register_name}
      />
    </AdminShell>
  );
}
