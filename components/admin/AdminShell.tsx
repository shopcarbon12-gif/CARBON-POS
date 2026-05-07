"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

const STORAGE_KEY = "carbon-pos:shell";

type Persisted = {
  /** When true the sidebar is fixed open and the main content shrinks. */
  pinned: boolean;
  /**
   * When true and not pinned, the sidebar is "temporarily open" with a
   * dark overlay. Click outside or press Esc to close back to A.
   */
  open: boolean;
};

const DEFAULT_STATE: Persisted = { pinned: true, open: false };

function readState(): Persisted {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      pinned: parsed.pinned ?? DEFAULT_STATE.pinned,
      open: parsed.open ?? DEFAULT_STATE.open,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(s: Persisted) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore storage errors (private mode, full disk, etc.) */
  }
}

/**
 * Shared chrome for every authenticated page. Renders three states:
 *
 *   A — closed         (hamburger visible, sidebar hidden, content full-width)
 *   B — open temporary (hamburger visible, sidebar floats over content with dark overlay)
 *   C — pinned         (hamburger hidden, sidebar fixed left, content shrunk)
 *
 * Transitions:
 *   A → click hamburger → B
 *   B → click overlay or hamburger → A
 *   B → click pin → C
 *   C → click pin → B
 *
 * Default on first load: C (pinned). State persists in localStorage.
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
  /** Override the topbar title. Defaults to the tab label. */
  title?: string;
}) {
  // Hydrate from localStorage on the client. The server renders the default
  // (pinned) shape so we don't bounce the layout on hydration; the client
  // takes over once mounted.
  const [pinned, setPinned] = useState(DEFAULT_STATE.pinned);
  const [open, setOpen] = useState(DEFAULT_STATE.open);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const s = readState();
    setPinned(s.pinned);
    setOpen(s.open);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeState({ pinned, open });
  }, [pinned, open, hydrated]);

  // Esc key closes the open-but-unpinned drawer.
  useEffect(() => {
    if (!open || pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pinned]);

  const sidebarVisible = pinned || open;

  const onHamburger = useCallback(() => {
    setOpen((o) => !o);
  }, []);

  const onTogglePin = useCallback(() => {
    setPinned((wasPinned) => {
      // Pinning while open: stay visible, no overlay (state C).
      // Unpinning: keep the sidebar open temporarily (state B), so the
      // user sees what they had and can click overlay to dismiss.
      const next = !wasPinned;
      if (next) setOpen(false); // pinned doesn't need open=true
      else setOpen(true);
      return next;
    });
  }, []);

  const onOverlayClick = useCallback(() => {
    if (!pinned) setOpen(false);
  }, [pinned]);

  // Auto-close the temporary drawer when the user navigates via a nav link,
  // unless pinned. Pinned mode keeps the sidebar visible across pages.
  const onNavClick = useCallback(() => {
    if (!pinned) setOpen(false);
  }, [pinned]);

  const tabIcon =
    NAV.find((n) => n.key === active)?.icon ?? TAB_LABELS[active].toLowerCase();
  const headline = title ?? TAB_LABELS[active];

  return (
    <div className="min-h-screen bg-carbon-bg text-carbon-text">
      {/* Sidebar */}
      <aside
        className={`carbon-sidebar fixed left-0 top-0 h-screen flex flex-col py-8 px-3 z-40 transition-transform duration-200 ${
          sidebarVisible ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!sidebarVisible}
      >
        <Link
          href={`/dashboard/${code}`}
          onClick={onNavClick}
          className="mb-10 px-3 flex items-center gap-3"
        >
          <span className="w-10 h-10 bg-carbon-blue text-white font-bold text-xl flex items-center justify-center">
            C
          </span>
          <span>
            <span className="block text-lg font-bold tracking-tight">
              Carbon
            </span>
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
              onClick={onNavClick}
              className={`carbon-nav-item ${active === item.key ? "active" : ""}`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span>{TAB_LABELS[item.key]}</span>
            </Link>
          ))}
        </nav>

        {/* Pin toggle + identity strip at the bottom of the sidebar. */}
        <div className="border-t border-carbon-border-soft pt-4 mt-4 px-4 space-y-3">
          <button
            type="button"
            onClick={onTogglePin}
            className="flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-carbon-text-muted hover:text-carbon-blue transition-colors"
            aria-pressed={pinned}
            title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
          >
            <span
              className={`material-symbols-outlined text-base ${
                pinned ? "text-carbon-blue" : ""
              }`}
              style={pinned ? { fontVariationSettings: '"FILL" 1' } : undefined}
            >
              push_pin
            </span>
            <span>{pinned ? "Pinned" : "Pin sidebar"}</span>
          </button>
          <div>
            <p className="text-xs text-carbon-text-muted truncate">
              {email ?? ""}
            </p>
            <Link
              href="/api/auth/signout"
              className="text-xs text-carbon-text-muted hover:text-carbon-blue underline mt-1 inline-block"
            >
              Sign out
            </Link>
          </div>
        </div>
      </aside>

      {/* Dark overlay when sidebar is unpinned + open. */}
      {!pinned && open ? (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onOverlayClick}
          className="fixed inset-0 bg-black/55 z-30 cursor-default"
        />
      ) : null}

      {/* Main column. Shrinks only when the sidebar is pinned. */}
      <div
        className="flex flex-col min-h-screen transition-[margin-left] duration-200"
        style={{
          marginLeft: pinned ? "var(--carbon-sidebar-w)" : "0",
        }}
      >
        <header className="carbon-topbar sticky top-0 z-20 flex items-center justify-between px-6 lg:px-8 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {!pinned ? (
              <button
                type="button"
                onClick={onHamburger}
                aria-label="Open sidebar"
                className="text-carbon-text hover:text-carbon-blue transition-colors"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
            ) : null}
            <span
              className="material-symbols-outlined text-carbon-blue"
              aria-hidden
            >
              {tabIcon}
            </span>
            <h1 className="text-lg font-bold tracking-tight truncate">
              {headline}
            </h1>
          </div>
          <div className="flex items-center gap-4 shrink-0">{rightSlot}</div>
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
