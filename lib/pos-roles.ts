/**
 * POS role helpers.
 *
 * The real POS role lives in user_roles (scope='pos') and is referenced by
 * pos_employees.pos_role_id — e.g. "Super Admin", "Manager", "Key Holder".
 * A legacy text column pos_employees.role (cashier|supervisor|manager|admin,
 * CHECK-constrained) is kept in lockstep for older code paths.
 */

/** Display label for an employee's role: prefer the real POS-role name, else
 *  map the legacy text. So a row never shows the bare "admin" again. */
export function posRoleLabel(
  posRoleName?: string | null,
  legacyRole?: string | null,
): string {
  const n = (posRoleName ?? "").trim();
  if (n) return n;
  switch ((legacyRole ?? "").trim().toLowerCase()) {
    case "admin":
      return "Super Admin";
    case "manager":
      return "Manager";
    case "supervisor":
      return "Supervisor";
    case "cashier":
      return "Cashier";
    default:
      return legacyRole || "—";
  }
}

/** Map a POS-role *name* down to the CHECK-constrained legacy enum so the
 *  pos_employees.role text column stays valid. Unknown → 'cashier'. */
export function legacyRoleForPosRoleName(
  name: string | null | undefined,
): "cashier" | "supervisor" | "manager" | "admin" {
  const n = (name ?? "").trim().toLowerCase();
  if (n === "super admin" || n === "admin") return "admin";
  if (n === "manager") return "manager";
  if (n === "supervisor") return "supervisor";
  return "cashier";
}
