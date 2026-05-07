"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Location = {
  id: string;
  code: string;
  name: string;
};

/**
 * Click-to-switch grid for the /locations/{code} page. Posts to
 * /api/pos/auth/switch-location, which rewrites the session JWT, then
 * navigates to /dashboard/{newCode} so the URL self-corrects.
 */
export function LocationsSwitcher({
  locations,
  currentLocationId,
}: {
  locations: Location[];
  currentLocationId: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(loc: Location) {
    if (loc.id === currentLocationId) return;
    setBusyId(loc.id);
    setError(null);
    const res = await fetch("/api/pos/auth/switch-location", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location_id: loc.id }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Couldn't switch location.");
      setBusyId(null);
      return;
    }
    // Land on the dashboard for the new location. router.refresh ensures
    // server components re-read the session.
    router.replace(`/dashboard/${loc.code}`);
    router.refresh();
  }

  if (locations.length === 0) {
    return (
      <div className="carbon-card p-8 text-center text-carbon-text-muted">
        You don&rsquo;t have access to any active locations. Ask a manager
        to add you to one.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {locations.map((loc) => {
          const isCurrent = loc.id === currentLocationId;
          const isBusy = busyId === loc.id;
          return (
            <button
              key={loc.id}
              type="button"
              onClick={() => void pick(loc)}
              disabled={isCurrent || isBusy}
              className={`carbon-card text-left p-5 flex items-start gap-4 transition-colors ${
                isCurrent
                  ? "border-carbon-blue bg-[var(--carbon-blue-soft)] cursor-default"
                  : "hover:bg-[var(--carbon-surface-soft)] cursor-pointer"
              } ${isBusy ? "opacity-60" : ""}`}
            >
              <span
                className={`material-symbols-outlined text-3xl mt-0.5 ${
                  isCurrent ? "text-carbon-blue" : "text-carbon-text-muted"
                }`}
                aria-hidden
              >
                {isCurrent ? "check_circle" : "store"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-carbon-text leading-snug truncate">
                  {loc.name}
                </p>
                <p className="text-xs font-mono text-carbon-text-muted mt-0.5">
                  {loc.code}
                </p>
                <p
                  className={`text-xs mt-2 font-semibold uppercase tracking-wider ${
                    isCurrent ? "text-carbon-blue" : "text-carbon-text-muted"
                  }`}
                >
                  {isCurrent
                    ? "Currently active"
                    : isBusy
                      ? "Switching…"
                      : "Tap to switch"}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="text-sm text-carbon-danger mt-4">{error}</p>
      ) : null}
    </>
  );
}
