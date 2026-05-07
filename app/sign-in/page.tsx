"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

type Loc = { id: string; code: string; name: string };

/**
 * Two-step POS sign-in.
 *   Step 1: location email + password. We ping
 *           POST /api/auth/locations-for-email which returns every location
 *           that accepts the credentials.
 *   Step 2: 4-digit PIN keypad. If multiple locations matched the email, the
 *           keypad starts disabled and the user picks a location first.
 *
 * On success we land at /dashboard/<lcode>.
 */
export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-carbon-bg">
          <p className="text-carbon-text-muted">Loading…</p>
        </main>
      }
    >
      <SignInInner />
    </Suspense>
  );
}

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const fromParam = params.get("from") ?? null;

  const [stage, setStage] = useState<"creds" | "pin">("creds");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [locations, setLocations] = useState<Loc[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pinRef = useRef(pin);
  pinRef.current = pin;
  const locIdRef = useRef(locationId);
  locIdRef.current = locationId;

  /** Step 1 — verify location credentials. */
  const submitCreds = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        const res = await fetch("/api/auth/locations-for-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        if (!res.ok) {
          setError("Email or password didn't match a location.");
          return;
        }
        const data = (await res.json()) as { locations: Loc[] };
        const list = data.locations ?? [];
        if (list.length === 0) {
          setError("Email or password didn't match a location.");
          return;
        }
        setLocations(list);
        // Auto-select if only one location matched, otherwise the user
        // must pick before the PIN keypad enables.
        setLocationId(list.length === 1 ? list[0].id : "");
        setPin("");
        setStage("pin");
      } finally {
        setBusy(false);
      }
    },
    [email, password],
  );

  /** Step 2 — submit PIN once 4 digits are entered. */
  const submitPin = useCallback(
    async (value: string, locId: string) => {
      if (!locId) return;
      setBusy(true);
      setError(null);
      const chosen = locations.find((l) => l.id === locId);
      const res = await signIn("pin", {
        email: email.trim(),
        password,
        pin: value,
        locationId: locId,
        redirect: false,
      });
      setBusy(false);
      if (!res || res.error) {
        setError("That PIN didn't match for this location.");
        setPin("");
        return;
      }
      const target = chosen
        ? `/dashboard/${chosen.code}`
        : (fromParam ?? "/");
      router.replace(target);
    },
    [email, password, locations, fromParam, router],
  );

  const tapDigit = useCallback((d: string) => {
    setPin((prev) => (prev + d).slice(0, 4));
  }, []);
  const tapBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);
  const tapEnter = useCallback(() => {
    const v = pinRef.current;
    const lid = locIdRef.current;
    if (!lid) {
      setError("Pick a location first.");
      return;
    }
    if (v.length !== 4) {
      setError("Enter all 4 digits, then press Enter.");
      return;
    }
    void submitPin(v, lid);
  }, [submitPin]);

  // Hardware keyboard support on the PIN screen.
  useEffect(() => {
    if (stage !== "pin") return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        tapDigit(e.key);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        tapBackspace();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        tapEnter();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPin("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, busy, tapDigit, tapBackspace, tapEnter]);

  const keypadDisabled = busy || !locationId;

  return (
    <main className="min-h-screen grid lg:grid-cols-2 bg-carbon-bg">
      {/* Brand panel — solid Carbon Blue with the wordmark. */}
      <aside
        className="hidden lg:flex flex-col justify-between p-12 text-white"
        style={{ background: "var(--carbon-blue)" }}
      >
        <div className="flex items-end gap-4">
          {/* Logo lockup — bigger logo with the CarbonPOS wordmark in
              Neuzeit Grotesk bottom-aligned beside it. Wordmark color
              is black per spec. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Carbon"
            className="w-40 h-40 object-cover shrink-0"
          />
          <span className="carbon-wordmark text-5xl font-semibold tracking-tight leading-none pb-2 text-black">
            CarbonPOS
          </span>
        </div>
        <div>
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            Carbon POS.
            <br />
            <span className="opacity-70">Sell sharp. Move fast.</span>
          </h2>
          <p className="mt-4 text-sm opacity-80 max-w-md">
            Sign in with your location credentials, pick the store you&apos;re
            working from, then tap your PIN.
          </p>
        </div>
        <p className="text-xs opacity-60">
          © Carbon Jeans Company. All rights reserved.
        </p>
      </aside>

      <section className="flex items-center justify-center p-6">
        <div className="carbon-card w-full max-w-md p-10">
          <div className="lg:hidden flex items-end gap-4 mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="Carbon"
              className="w-32 h-32 object-cover shrink-0"
            />
            <span className="carbon-wordmark text-4xl font-semibold tracking-tight leading-none pb-1.5 text-black">
              CarbonPOS
            </span>
          </div>

          {stage === "creds" ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight mb-1">
                Location sign in
              </h1>
              <p className="text-carbon-text-muted text-sm mb-8">
                Enter the credentials your admin set for this location.
              </p>
              <form onSubmit={submitCreds} className="flex flex-col gap-4">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="carbon-input tap w-full"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="carbon-input tap w-full"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="carbon-btn-primary tap-lg w-full text-base mt-2"
                >
                  {busy ? "Signing in…" : "Continue"}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight mb-1">
                Cashier PIN
              </h1>
              <p className="text-carbon-text-muted text-sm mb-6">
                {locations.length > 1
                  ? "Pick a location, then tap your 4-digit PIN."
                  : `Signing in to ${locations[0]?.code} · ${locations[0]?.name}.`}
              </p>

              {locations.length > 1 ? (
                <div className="mb-6">
                  <label className="block text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted mb-2">
                    Location
                  </label>
                  <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="carbon-input tap w-full"
                  >
                    <option value="">— Choose a location —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} · {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex gap-3 justify-center mb-6">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`pin-dot w-4 h-4 border-2 ${
                      i < pin.length
                        ? "bg-carbon-blue border-carbon-blue"
                        : "border-carbon-border"
                    }`}
                  />
                ))}
              </div>
              <div
                className={`grid grid-cols-3 gap-3 ${
                  keypadDisabled ? "opacity-50 pointer-events-none" : ""
                }`}
                aria-disabled={keypadDisabled}
              >
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={keypadDisabled}
                    className="tap-lg carbon-btn-secondary text-2xl font-semibold"
                    onClick={() => tapDigit(d)}
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={keypadDisabled}
                  className="tap-lg carbon-btn-ghost text-carbon-text-muted text-sm font-semibold uppercase tracking-wider"
                  onClick={() => setPin("")}
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={keypadDisabled}
                  className="tap-lg carbon-btn-secondary text-2xl font-semibold"
                  onClick={() => tapDigit("0")}
                >
                  0
                </button>
                <button
                  type="button"
                  disabled={keypadDisabled || pin.length !== 4}
                  className="tap-lg carbon-btn-primary text-sm font-bold uppercase tracking-wider"
                  onClick={tapEnter}
                >
                  {busy ? "…" : "Enter"}
                </button>
              </div>
              {keypadDisabled && !busy ? (
                <p className="text-[11px] text-carbon-text-muted text-center mt-3 uppercase tracking-wider">
                  Pick a location to enable the keypad.
                </p>
              ) : (
                <p className="text-[11px] text-carbon-text-muted text-center mt-3 uppercase tracking-wider">
                  You can also type your PIN on the keyboard.
                </p>
              )}

              <button
                className="w-full mt-6 text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
                onClick={() => {
                  setStage("creds");
                  setPin("");
                  setError(null);
                }}
              >
                ← Use a different email
              </button>
            </>
          )}

          {error && (
            <p className="mt-6 text-center text-carbon-danger text-sm">
              {error}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
