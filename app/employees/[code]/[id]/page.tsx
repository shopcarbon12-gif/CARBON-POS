import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { EmployeeEditor } from "./EmployeeEditor";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  const cashier = await pageGuard(code, {
    tab: "employees",
    from: `/employees/${code}/${id}`,
  }, { requireRole: ["manager", "admin"] });
  const isSuperAdmin = cashier.role === "admin";
  const eid = Number(id);
  if (!Number.isFinite(eid)) notFound();
  const pool = getPool();
  const [emp, clock] = await Promise.all([
    pool.query(
      `SELECT pe.*, u.email, u.first_name, u.last_name,
              ur.name AS pos_role_name
         FROM pos_employees pe
         JOIN users u ON u.id = pe.user_id
         LEFT JOIN user_roles ur ON ur.id = pe.pos_role_id AND ur.scope = 'pos'
        WHERE pe.id = $1`,
      [eid],
    ),
    pool.query(
      `SELECT id, clock_in, clock_out, register_id
         FROM pos_employee_clock
        WHERE employee_id = $1
        ORDER BY clock_in DESC
        LIMIT 50`,
      [eid],
    ),
  ]);
  const employee = emp.rows[0];
  if (!employee) notFound();
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4">
        <Link
          href={`/employees/${code}`}
          className="text-sm text-[var(--color-pos-muted)] underline"
        >
          ← All employees
        </Link>
        <h1 className="text-xl font-bold mt-1">
          {[employee.first_name, employee.last_name].filter(Boolean).join(" ") ||
            employee.email}
        </h1>
        <p className="text-xs text-[var(--color-pos-muted)]">
          Joined {new Date(employee.created_at).toLocaleDateString()}
          {employee.is_active ? "" : " · Archived"}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
        <section className="lg:col-span-2">
          <EmployeeEditor
            code={code}
            isSuperAdmin={isSuperAdmin}
            initial={{
              id: employee.id,
              first_name: employee.first_name ?? "",
              last_name: employee.last_name ?? "",
              email: employee.email,
              pos_role_id: employee.pos_role_id ?? null,
              pos_role_name: employee.pos_role_name ?? null,
              role: employee.role,
              is_active: employee.is_active,
            }}
          />
        </section>
        <aside className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
          <h2 className="font-semibold mb-2">Recent clock activity</h2>
          {clock.rows.length === 0 ? (
            <p className="text-sm text-[var(--color-pos-muted)]">
              No clock-in entries yet.
            </p>
          ) : (
            <ul className="text-sm divide-y divide-[var(--color-pos-border)]">
              {clock.rows.map((c) => {
                const inAt = new Date(c.clock_in);
                const outAt = c.clock_out ? new Date(c.clock_out) : null;
                const minutes = outAt
                  ? Math.round((outAt.getTime() - inAt.getTime()) / 60000)
                  : null;
                return (
                  <li key={c.id} className="py-2">
                    <p>
                      {inAt.toLocaleString()} →{" "}
                      {outAt ? outAt.toLocaleString() : "still on"}
                    </p>
                    {minutes !== null && (
                      <p className="text-xs text-[var(--color-pos-muted)]">
                        {(minutes / 60).toFixed(2)} hours
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}
