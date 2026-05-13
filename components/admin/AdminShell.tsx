"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";

type Tab =
  | "dashboard"
  | "sales"
  | "pos"
  | "inventory"
  | "reports"
  | "customers"
  | "settings";

const TAB_LABELS: Record<Tab, string> = {
  dashboard: "Dashboard",
  sales: "Orders",
  pos: "Point of Sale",
  inventory: "Products",
  reports: "Reports",
  customers: "Customers",
  settings: "Settings",
};

const NAV: Array<{ key: Tab; icon: string; href: (code: string) => string }> = [
  { key: "dashboard", icon: "dashboard",     href: (c) => `/dashboard/${c}` },
  { key: "pos",       icon: "point_of_sale", href: (c) => `/sales/${c}/new` },
  { key: "sales",     icon: "receipt_long",  href: (c) => `/sales/${c}` },
  { key: "inventory", icon: "inventory_2",   href: (c) => `/inventory/${c}` },
  { key: "customers", icon: "people",        href: (c) => `/customers/${c}` },
  { key: "reports",   icon: "monitoring",    href: (c) => `/reports/${c}` },
  { key: "settings",  icon: "settings",      href: (c) => `/settings/${c}` },
];

/**
 * Shared chrome for every authenticated page. Horizontal top-nav layout:
 *
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │ [logo+wordmark]  [tab][tab][tab…active…][tab]   [location ▾ user] │
 *   └───────────────────────────────────────────────────────────────────┘
 *   │  page content                                                       │
 *
 * Active tab renders as a solid Carbon-Blue pill (sharp corners), inactive
 * tabs are muted with a hover wash. Tabs scroll horizontally on narrow
 * screens — no drawer.
 */
export function AdminShell({
  email,
  active,
  code,
  children,
  rightSlot,
}: {
  email: string | null;
  active: Tab;
  /** Active location code from the URL — used to build all nav links. */
  code: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  /** Optional page-title override. Currently unused in the top-nav layout
   *  but kept on the API so existing pages don't break. */
  title?: string;
}) {
  // Location-box context — fetched once per mount. Falls back to the URL
  // `code` while loading so the chrome doesn't flash.
  const [locName, setLocName] = useState<string | null>(null);
  const [canSwitchLoc, setCanSwitchLoc] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/pos/auth/me");
        if (!res.ok) return;
        const data = (await res.json()) as {
          location_name?: string;
          can_switch_location?: boolean;
        };
        if (cancelled) return;
        if (data.location_name) setLocName(data.location_name);
        setCanSwitchLoc(Boolean(data.can_switch_location));
      } catch {
        /* ignore — chrome falls back to the URL code */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-carbon-bg text-carbon-text flex flex-col">
      {/* Top nav bar */}
      <header className="carbon-topbar sticky top-0 z-30 flex items-center justify-between gap-4 px-4 lg:px-6">
        {/* Brand */}
        <Link
          href={`/dashboard/${code}`}
          className="flex items-center gap-2 shrink-0 pr-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Carbon"
            className="w-9 h-9 object-cover shrink-0"
            onError={(e) => {
              const el = e.currentTarget;
              el.style.display = "none";
              const fallback = el.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = "flex";
            }}
          />
          <span
            className="w-9 h-9 bg-carbon-blue text-white font-bold text-lg items-center justify-center hidden shrink-0"
          >
            C
          </span>
          <span className="carbon-wordmark text-lg font-semibold tracking-tight text-carbon-text whitespace-nowrap">
            <span className="text-carbon-blue">Carbon</span>POS
          </span>
        </Link>

        {/* Tabs */}
        <nav className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto overflow-y-hidden scrollbar-none">
          {NAV.map((item) => {
            const isActive = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href(code)}
                aria-current={isActive ? "page" : undefined}
                className={`carbon-tab ${isActive ? "carbon-tab-active" : ""}`}
              >
                <span
                  className="material-symbols-outlined text-[20px] leading-none"
                  aria-hidden
                >
                  {item.icon}
                </span>
                <span className="whitespace-nowrap">{TAB_LABELS[item.key]}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right cluster: optional page slot + location/user */}
        <div className="flex items-center gap-3 shrink-0">
          {rightSlot ? (
            <div className="hidden md:flex items-center">{rightSlot}</div>
          ) : null}
          <LocationUserMenu
            code={code}
            locName={locName ?? code}
            email={email}
            canSwitch={canSwitchLoc}
            open={userMenuOpen}
            onToggle={() => setUserMenuOpen((v) => !v)}
            onClose={() => setUserMenuOpen(false)}
            onSwitch={() => {
              setUserMenuOpen(false);
              router.push(`/locations/${code}`);
            }}
          />
        </div>
      </header>

      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}

/**
 * Right-end of the topbar: a clickable chip that shows the active location
 * plus a small avatar circle. Clicking opens a tiny menu with Switch
 * Location (if eligible) and Sign Out.
 */
function LocationUserMenu({
  code,
  locName,
  email,
  canSwitch,
  open,
  onToggle,
  onClose,
  onSwitch,
}: {
  code: string;
  locName: string;
  email: string | null;
  canSwitch: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSwitch: () => void;
}) {
  // Click-outside / Esc close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (!tgt?.closest?.("[data-locuser]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const initials = (email ?? "?")
    .split(/[@.\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";

  return (
    <div data-locuser className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 border border-carbon-border bg-carbon-surface px-3 h-10 hover:bg-[var(--carbon-surface-soft)] transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="material-symbols-outlined text-carbon-blue text-[20px]"
          aria-hidden
        >
          store
        </span>
        <span className="text-sm font-bold text-carbon-text truncate max-w-[160px]">
          {locName}
        </span>
        <span
          className="material-symbols-outlined text-carbon-text-muted text-[18px]"
          aria-hidden
        >
          expand_more
        </span>
        <span
          aria-hidden
          className="ml-1 w-8 h-8 bg-carbon-blue text-white text-xs font-bold flex items-center justify-center"
        >
          {initials}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] min-w-[240px] bg-carbon-surface border border-carbon-border shadow-lg z-40"
        >
          <div className="px-4 py-3 border-b border-carbon-border-soft">
            <p className="text-[10px] uppercase tracking-wider font-bold text-carbon-text-muted">
              Signed in
            </p>
            <p className="text-sm text-carbon-text truncate mt-0.5">
              {email ?? "—"}
            </p>
          </div>
          {canSwitch ? (
            <button
              type="button"
              onClick={onSwitch}
              role="menuitem"
              className="w-full text-left px-4 py-3 hover:bg-[var(--carbon-surface-soft)] flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px] text-carbon-text-muted" aria-hidden>
                swap_horiz
              </span>
              <span className="text-sm font-medium">Switch location</span>
            </button>
          ) : (
            <div
              className="px-4 py-3 flex items-center gap-2 opacity-70"
              title="Only one location available"
            >
              <span className="material-symbols-outlined text-[20px] text-carbon-text-muted" aria-hidden>
                store
              </span>
              <span className="text-sm text-carbon-text-muted">
                {locName} ({code})
              </span>
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: "/sign-in" })}
            className="w-full text-left px-4 py-3 hover:bg-[var(--carbon-surface-soft)] flex items-center gap-2 border-t border-carbon-border-soft"
          >
            <span className="material-symbols-outlined text-[20px] text-carbon-text-muted" aria-hidden>
              logout
            </span>
            <span className="text-sm font-medium">Sign out</span>
          </button>
        </div>
      ) : null}
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
