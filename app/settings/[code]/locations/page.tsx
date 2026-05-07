import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { LocationsManager } from "./LocationsManager";

export default async function LocationsSettingsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "settings",
    from: `/settings/${code}/locations`,
  }, { requireRole: ["manager", "admin"] });
  const pool = getPool();
  const [locs, avail] = await Promise.all([
    pool.query(
      `SELECT pl.*, l.name AS wms_name,
              (SELECT COUNT(*) FROM pos_registers r
                WHERE r.pos_location_id = pl.id) AS register_count
         FROM pos_locations pl
         JOIN locations l ON l.id = pl.wms_location_id
        ORDER BY l.name`,
    ),
    pool.query(
      `SELECT l.id, l.name
         FROM locations l
        WHERE NOT EXISTS (
          SELECT 1 FROM pos_locations pl WHERE pl.wms_location_id = l.id
        )
        ORDER BY l.name`,
    ),
  ]);
  return (
    <AdminShell email={cashier.email} active="settings" code={code}>
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href={`/settings/${code}`}
          className="text-sm text-[var(--color-pos-muted)] underline"
        >
          ← Settings
        </Link>
        <h1 className="text-xl font-bold mt-1">Locations</h1>
        <p className="text-xs text-[var(--color-pos-muted)] mt-1">
          Each POS location maps to exactly one WMS site. Tax rate is per
          location.
        </p>
      </header>
      <section className="p-6">
        <LocationsManager
          locations={locs.rows}
          availableWmsLocations={avail.rows}
        />
      </section>
    </AdminShell>
  );
}
