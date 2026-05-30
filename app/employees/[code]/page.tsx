import Link from "next/link";
import { getPool } from "@/lib/db";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { posRoleLabel } from "@/lib/pos-roles";
import { EmployeeRowActions } from "./EmployeeRowActions";

export default async function EmployeesPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cashier = await pageGuard(code, {
    tab: "settings",
    from: `/employees/${code}`,
  }, { requireRole: ["manager", "admin"] });
  const isSuperAdmin = cashier.role === "admin";
  const pool = getPool();
  const r = await pool.query(
    `SELECT pe.id, pe.role, pe.is_active, pe.created_at,
            u.email, u.first_name, u.last_name,
            ur.name AS pos_role_name
       FROM pos_employees pe
       JOIN users u ON u.id = pe.user_id
       LEFT JOIN user_roles ur ON ur.id = pe.pos_role_id AND ur.scope = 'pos'
      ORDER BY pe.is_active DESC, u.last_name NULLS LAST, u.first_name, u.email`,
  );
  return (
    <AdminShell email={cashier.email} active="settings" code={code} title="Employees">
      <section className="p-3 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-[var(--color-pos-muted)]">
            Cashiers and back-office staff. PINs are 4-digit codes used at the
            register.
          </p>
          <Link
            href={`/employees/${code}/new`}
            className="carbon-btn-primary tap inline-flex items-center justify-center px-6 font-semibold"
          >
            + New employee
          </Link>
        </div>
        <table className="w-full text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
          <thead className="bg-[var(--color-pos-bg)]">
            <tr className="text-left">
              <th className="px-3 py-2">First name</th>
              <th className="px-3 py-2">Last name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Added</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
                >
                  No employees set up yet — add one to enable PIN sign-in.
                </td>
              </tr>
            ) : (
              r.rows.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-[var(--color-pos-border)]"
                >
                  <td className="px-3 py-2">{e.first_name ?? "—"}</td>
                  <td className="px-3 py-2">{e.last_name ?? "—"}</td>
                  <td className="px-3 py-2">{e.email}</td>
                  <td className="px-3 py-2">
                    {posRoleLabel(e.pos_role_name, e.role)}
                  </td>
                  <td className="px-3 py-2">
                    {e.is_active ? (
                      <span className="text-green-700">Active</span>
                    ) : (
                      <span className="text-[var(--color-pos-danger)] font-medium">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {new Date(e.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <EmployeeRowActions
                      code={code}
                      id={e.id}
                      isActive={e.is_active}
                      isSuperAdmin={isSuperAdmin}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
