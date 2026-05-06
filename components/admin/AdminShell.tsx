import Link from "next/link";

type AdminTab =
  | "dashboard"
  | "sales"
  | "reports"
  | "customers"
  | "employees"
  | "settings";

const NAV: Array<{ href: string; label: string; icon: string; key: AdminTab }> =
  [
    { href: "/admin",           label: "Dashboard", icon: "dashboard",     key: "dashboard" },
    { href: "/admin/sales",     label: "Sales",     icon: "receipt_long",  key: "sales"     },
    { href: "/admin/reports",   label: "Reports",   icon: "monitoring",    key: "reports"   },
    { href: "/admin/customers", label: "Customers", icon: "people",        key: "customers" },
    { href: "/admin/employees", label: "Employees", icon: "badge",         key: "employees" },
    { href: "/admin/settings",  label: "Settings",  icon: "settings",      key: "settings"  },
  ];

/**
 * Shared chrome for every /admin/* page. Renders the Carbon shell:
 *   left sidebar (256px, white, brand box + nav)  +  topbar (80px, sticky).
 * Children fill the workspace.
 */
export function AdminShell({
  email,
  active,
  children,
  rightSlot,
  title = "Carbon POS — Back Office",
}: {
  email: string | null;
  active: AdminTab;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex min-h-screen bg-carbon-bg text-carbon-text">
      <aside className="carbon-sidebar fixed left-0 top-0 h-screen flex flex-col py-8 px-3 z-40">
        <Link href="/admin" className="mb-10 px-3 flex items-center gap-3">
          <span className="w-10 h-10 bg-carbon-blue text-white font-bold text-xl flex items-center justify-center">
            C
          </span>
          <span>
            <span className="block text-lg font-bold tracking-tight">Carbon</span>
            <span className="block text-xs text-carbon-text-muted">Back Office</span>
          </span>
        </Link>

        <Link
          href="/pos"
          className="carbon-btn-primary mb-8 mx-1 py-3 px-4 flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-base">point_of_sale</span>
          <span>Open Register</span>
        </Link>

        <nav className="flex-1 flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`carbon-nav-item ${active === item.key ? "active" : ""}`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="border-t border-carbon-border-soft pt-4 mt-4 px-4">
          <p className="text-xs text-carbon-text-muted truncate">{email ?? ""}</p>
          <Link
            href="/api/auth/signout"
            className="text-xs text-carbon-text-muted hover:text-carbon-blue underline mt-1 inline-block"
          >
            Sign out
          </Link>
        </div>
      </aside>

      <div
        className="flex-1 flex flex-col"
        style={{ marginLeft: "var(--carbon-sidebar-w)" }}
      >
        <header className="carbon-topbar sticky top-0 z-30 flex items-center justify-between px-8">
          <h1 className="text-lg font-bold tracking-tight">{title}</h1>
          <div className="flex items-center gap-4">{rightSlot}</div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

/** KPI / stat card used on the dashboard and reports. */
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
    <div className="carbon-stat">
      <p className="text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted">
        {label}
      </p>
      <p className="total-display text-3xl mt-2">{value}</p>
      {sub && <p className="text-xs text-carbon-text-muted mt-2">{sub}</p>}
    </div>
  );
}
