import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { LocationsSwitcher } from "./LocationsSwitcher";

/**
 * Location switcher. Lists every location the signed-in user has access to
 * via `user_locations`. Clicking a location swaps the session's active
 * location and lands the user on /dashboard/{newCode}.
 *
 * The page is rendered for everyone — even if you only have one location.
 * In that case the LocationsSwitcher just shows a single non-clickable card
 * confirming where you are. The "highlighted location box" in the chrome
 * disables itself in that case so users without multi-location access never
 * land here unintentionally.
 */
export default async function LocationsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "settings",
    from: `/locations/${code}`,
  });
  const pool = getPool();
  const r = await pool.query<{
    id: string;
    code: string;
    name: string;
  }>(
    `SELECT l.id::text, l.code, l.name
       FROM user_locations ul
       JOIN locations l ON l.id = ul.location_id
      WHERE ul.user_id = $1::uuid
        AND l.is_active = TRUE
      ORDER BY l.name ASC`,
    [cashier.user_id],
  );
  return (
    <AdminShell
      email={cashier.email}
      active="settings"
      code={code}
      title="Switch Location"
    >
      <main className="p-6 lg:p-10">
        <div className="max-w-3xl mx-auto">
          <header className="mb-6">
            <h2 className="text-2xl font-bold tracking-tight">
              Switch Location
            </h2>
            <p className="text-sm text-carbon-text-muted mt-1">
              Pick a location to switch the active session. All scoped data
              (sales, inventory, registers) follows the location you choose.
            </p>
          </header>
          <LocationsSwitcher
            locations={r.rows}
            currentLocationId={cashier.lid}
          />
        </div>
      </main>
    </AdminShell>
  );
}
