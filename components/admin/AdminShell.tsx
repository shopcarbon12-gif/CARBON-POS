import Link from "next/link";

/**
 * Shared chrome for every /admin/* page. Renders the top nav and the page
 * frame; children are the page body. Server-component only — auth/role gate
 * lives in each page (and the middleware) so this can stay framework-light.
 */
export function AdminShell({
  email,
  active,
  children,
  rightSlot,
}: {
  email: string | null;
  active:
    | "dashboard"
    | "sales"
    | "reports"
    | "customers"
    | "employees"
    | "settings";
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Carbon POS — Back Office</h1>
          <p className="text-xs text-[var(--color-pos-muted)]">{email ?? ""}</p>
        </div>
        <nav className="flex gap-3 text-sm flex-wrap items-center">
          <NavItem href="/admin" label="Dashboard" active={active === "dashboard"} />
          <NavItem href="/admin/sales" label="Sales" active={active === "sales"} />
          <NavItem href="/admin/reports" label="Reports" active={active === "reports"} />
          <NavItem
            href="/admin/customers"
            label="Customers"
            active={active === "customers"}
          />
          <NavItem
            href="/admin/employees"
            label="Employees"
            active={active === "employees"}
          />
          <NavItem
            href="/admin/settings"
            label="Settings"
            active={active === "settings"}
          />
          <Link href="/pos" className="text-[var(--color-pos-muted)] underline ml-2">
            Register →
          </Link>
          {rightSlot}
        </nav>
      </header>
      {children}
    </main>
  );
}

function NavItem({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "font-semibold text-[var(--color-pos-ink)]"
          : "text-[var(--color-pos-muted)] hover:text-[var(--color-pos-ink)]"
      }
    >
      {label}
    </Link>
  );
}

/** Stat card used on the dashboard and reports. */
export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4">
      <p className="text-xs text-[var(--color-pos-muted)]">{label}</p>
      <p className="total-display text-3xl mt-1">{value}</p>
      {sub && <p className="text-xs text-[var(--color-pos-muted)] mt-1">{sub}</p>}
    </div>
  );
}
