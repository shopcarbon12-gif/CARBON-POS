import Link from "next/link";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { RegistersManager } from "./RegistersManager";

export default async function RegistersSettingsPage() {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    redirect("/sign-in?from=/admin/settings/registers");
  }
  const pool = getPool();
  const [regs, locs] = await Promise.all([
    pool.query(
      `SELECT r.*, l.name AS location_name
         FROM pos_registers r
         JOIN pos_locations pl ON pl.id = r.pos_location_id
         JOIN locations l      ON l.id = pl.wms_location_id
        ORDER BY l.name, r.name`,
    ),
    pool.query(
      `SELECT pl.id, l.name
         FROM pos_locations pl
         JOIN locations l ON l.id = pl.wms_location_id
        WHERE pl.is_active = TRUE
        ORDER BY l.name`,
    ),
  ]);
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href="/admin/settings"
          className="text-sm text-[var(--color-pos-muted)] underline"
        >
          ← Settings
        </Link>
        <h1 className="text-xl font-bold mt-1">Registers</h1>
      </header>
      <section className="p-6">
        <RegistersManager registers={regs.rows} locations={locs.rows} />
      </section>
    </main>
  );
}
