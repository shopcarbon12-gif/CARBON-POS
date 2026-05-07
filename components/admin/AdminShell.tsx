import Link from "next/link";

type Tab =
  | "dashboard"
  | "sales"
  | "pos"
  | "inventory"
  | "reports"
  | "customers"
  | "employees"
  | "settings";

const TAB_LABELS: Record<Tab, string> = {
  dashboard: "Dashboard",
  sales: "Sales",
  pos: "Point of Sale",
  inventory: "Inventory",
  reports: "Reports",
  customers: "Customers",
  employees: "Employees",
  settings: "Settings",
};

/**
 * `pos` is the cashier sell screen and `inventory` is the catalog browser —
 * both have their own sidebar entries per the stitch_luxe_cloud_pos
 * references. POS deep-links to /sales/{code}/new (the sell screen route).
 */
const NAV: Array<{ key: Tab; icon: string; href: (code: string) => string }> = [
  { key: "dashboard", icon: "dashboard",     href: (c) => `/dashboard/${c}` },
  { key: "sales",     icon: "receipt_long",  href: (c) => `/sales/${c}` },
  { key: "pos",       icon: "point_of_sale", href: (c) => `/sales/${c}/new` },
  { key: "inventory", icon: "inventory_2",   href: (c) => `/inventory/${c}` },
  { key: "reports",   icon: "monitoring",    href: (c) => `/reports/${c}` },
  { key: "customers", icon: "people",        href: (c) => `/customers/${c}` },
  { key: "employees", icon: "badge",         href: (c) => `/employees/${c}` },
  { key: "settings",  icon: "settings",      href: (c) => `/settings/${c}` },
];

/**
 * Shared chrome for every authenticated page. Renders the Carbon shell:
 *   left sidebar (256px, white, brand box + nav)  +  topbar (80px, sticky).
 *
 * Every nav link is built off `code` so a user signed into location 003
 * never accidentally lands on /dashboard/005. The page itself is responsible
 * for redirecting on a code/lcode mismatch (handled by middleware as a
 * defense-in-depth backstop).
 */
export function AdminShell({
  email,
  active,
  code,
  children,
  rightSlot,
  title,
}: {
  email: string | null;
  active: Tab;
  /** Active location code from the URL — used to build all nav links. */
  code: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  /** Override the topbar title. Defaults to "<Tab> · <code>". */
  title?: string;
}) {
  const headline = title ?? `${TAB_LABELS[active]} · ${code}`;
  return (
    <div className="flex min-h-screen bg-carbon-bg text-carbon-text">
      <aside className="carbon-sidebar fixed left-0 top-0 h-screen flex flex-col py-8 px-3 z-40">
        <Link
          href={`/dashboard/${code}`}
          className="mb-10 px-3 flex items-center gap-3"
        >
          <span className="w-10 h-10 bg-carbon-blue text-white font-bold text-xl flex items-center justify-center">
            C
          </span>
          <span>
            <span className="block text-lg font-bold tracking-tight">Carbon</span>
            <span className="block text-xs text-carbon-text-muted">
              POS · {code}
            </span>
          </span>
        </Link>

        <nav className="flex-1 flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href(code)}
              className={`carbon-nav-item ${active === item.key ? "active" : ""}`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span>{TAB_LABELS[item.key]}</span>
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
          <h1 className="text-lg font-bold tracking-tight">{headline}</h1>
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
