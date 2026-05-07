"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
  sales: "Sales",
  pos: "Point of Sale",
  inventory: "Inventory",
  reports: "Reports",
  customers: "Customers",
  settings: "Settings",
};

/**
 * `pos` is the cashier sell screen and `inventory` is the catalog browser —
 * both have their own sidebar entries per the stitch_luxe_cloud_pos
 * references. POS deep-links to /sales/{code}/new (the sell screen route).
 */
const NAV: Array<{ key: Tab; icon: string; href: (code: string) => string }> = [
  { key: "dashboard", icon: "dashboard",     href: (c) => `/dashboard/${c}` },
  { key: "pos",       icon: "point_of_sale", href: (c) => `/sales/${c}/new` },
  { key: "sales",     icon: "receipt_long",  href: (c) => `/sales/${c}` },
  { key: "inventory", icon: "inventory_2",   href: (c) => `/inventory/${c}` },
  { key: "reports",   icon: "monitoring",    href: (c) => `/reports/${c}` },
  { key: "customers", icon: "people",        href: (c) => `/customers/${c}` },
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
  // Location-box context — fetched once per mount. The chrome falls back
  // to the URL `code` while loading so the layout is stable.
  const [locName, setLocName] = useState<string | null>(null);
  const [canSwitchLoc, setCanSwitchLoc] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const s = readState();
    setPinned(s.pinned);
    setOpen(s.open);
    setHydrated(true);
  }, []);

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
          {/* Brand logo. Drop the source file at public/logo.jpg — the
              <img> tag falls back to a colored "C" tile if the file is
              missing so the chrome doesn't break before the asset lands. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Carbon"
            className="w-10 h-10 object-cover"
            onError={(e) => {
              const el = e.currentTarget;
              el.style.display = "none";
              const fallback = el.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = "flex";
            }}
          />
          <span
            className="w-10 h-10 bg-carbon-blue text-white font-bold text-xl items-center justify-center hidden"
          >
            C
          </span>
          <span className="carbon-wordmark text-2xl font-semibold tracking-tight text-carbon-text">
            CarbonPOS
          </span>
        </Link>

        {/* Highlighted location box. Sits between the logo and the
            Dashboard nav item. Click → /locations/{code} *only* when the
            user has access to multiple locations — otherwise it stays
            disabled (no point sending them somewhere they can't act on). */}
        <LocationBox
          code={code}
          name={locName ?? code}
          canSwitch={canSwitchLoc}
          onNavigate={() => {
            onNavClick();
            router.push(`/locations/${code}`);
          }}
        />

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

        {/* Identity strip at the bottom of the sidebar. Email + sign-out
            on the left, pin/unpin square button on the right — kept
            inside the sidebar so it doesn't crowd the topbar. */}
        <div className="border-t border-carbon-border-soft pt-4 mt-4 px-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
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
          <button
            type="button"
            onClick={onTogglePin}
            aria-pressed={pinned}
            title={pinned ? "Unpin sidebar (foldable)" : "Pin sidebar open"}
            className={`w-10 h-10 shrink-0 inline-flex items-center justify-center border transition-colors ${
              pinned
                ? "border-carbon-blue bg-[var(--carbon-blue-soft)] text-carbon-blue"
                : "border-carbon-border text-carbon-text-muted hover:bg-[var(--carbon-surface-soft)] hover:text-carbon-blue"
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={pinned ? { fontVariationSettings: '"FILL" 1' } : undefined}
              aria-hidden
            >
              push_pin
            </span>
          </button>
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
            {/* Hamburger only shows when the sidebar is unpinned — pinning
                hides it per spec ("If the menu is pinned, the hamburger
                disappears"). */}
            {!pinned ? (
              <button
                type="button"
                onClick={onHamburger}
                aria-label={open ? "Close sidebar" : "Open sidebar"}
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

/**
 * Highlighted location card under the logo. Always shows the location
 * name; click navigates to /locations/{code} *only* when the user has
 * access to multiple locations. Single-location users see it disabled
 * (cursor not-allowed, no hover state) so the box still communicates
 * "you are at X" without offering a switcher dead-end.
 */
function LocationBox({
  code,
  name,
  canSwitch,
  onNavigate,
}: {
  code: string;
  name: string;
  canSwitch: boolean;
  onNavigate: () => void;
}) {
  const Inner = (
    <>
      <span
        className="material-symbols-outlined text-carbon-blue text-xl"
        aria-hidden
      >
        store
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[10px] uppercase tracking-wider font-bold text-carbon-text-muted">
          Location
        </span>
        <span className="block text-sm font-bold text-carbon-text truncate">
          {name}
        </span>
      </span>
      {canSwitch ? (
        <span
          className="material-symbols-outlined text-carbon-text-muted text-base"
          aria-hidden
        >
          unfold_more
        </span>
      ) : null}
    </>
  );

  const baseCls =
    "mb-4 mx-1 px-3 py-2.5 flex items-center gap-2 border bg-[var(--carbon-blue-soft)] border-carbon-blue/30";

  if (canSwitch) {
    return (
      <button
        type="button"
        onClick={onNavigate}
        className={`${baseCls} text-left hover:bg-[color-mix(in_srgb,var(--carbon-blue)_15%,transparent)] transition-colors`}
        title={`${name} — switch location`}
      >
        {Inner}
      </button>
    );
  }
  return (
    <div
      className={`${baseCls} cursor-not-allowed opacity-90`}
      title={`${name} — only one location available`}
      aria-disabled
    >
      {Inner}
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
