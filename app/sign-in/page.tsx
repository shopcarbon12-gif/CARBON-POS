"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

type Loc = { id: string; code: string; name: string };
type Mode = "password" | "location" | "switch";

/**
 * POS sign-in with three modes:
 *   password  (default) — employee email + their POS password → pick location.
 *   switch    (?mode=switch) — "Change employee": PIN-only re-auth at the
 *             terminal's current location (requires an existing session).
 *   location  (fallback link) — the legacy location email + password + PIN.
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
  const initialMode: Mode = params.get("mode") === "switch" ? "switch" : "password";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // password / location shared creds
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [step, setStep] = useState<"creds" | "pick" | "pin">("creds");

  // pin (location fallback + switch)
  const [pin, setPin] = useState("");
  // switch: the terminal's current location code, for post-switch redirect
  const [switchLcode, setSwitchLcode] = useState<string | null>(null);

  const pinRef = useRef(pin);
  pinRef.current = pin;

  // In switch mode, learn the current location (proves a session exists).
  useEffect(() => {
    if (mode !== "switch") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/pos/auth/me");
        if (!res.ok) {
          // No active session → can't switch; fall back to password login.
          if (!cancelled) {
            setMode("password");
            setStep("creds");
          }
          return;
        }
        const d = (await res.json()) as { location_code?: string };
        if (!cancelled) setSwitchLcode(d.location_code ?? null);
      } catch {
        if (!cancelled) setMode("password");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  /** password mode — step 1: verify email + POS password, get locations. */
  const submitPasswordCreds = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        const res = await fetch("/api/pos/auth/locations-for-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        if (!res.ok) {
          setError("Email or password didn't match.");
          return;
        }
        const data = (await res.json()) as { locations: Loc[] };
        const list = data.locations ?? [];
        if (list.length === 0) {
          setError("No location is assigned to this login.");
          return;
        }
        if (list.length === 1) {
          await finishPassword(list[0]);
          return;
        }
        setLocations(list);
        setLocationId("");
        setStep("pick");
      } finally {
        setBusy(false);
      }
    },
    [email, password],
  );

  const finishPassword = useCallback(
    async (loc: Loc) => {
      setBusy(true);
      setError(null);
      const res = await signIn("password", {
        email: email.trim(),
        password,
        locationId: loc.id,
        redirect: false,
      });
      setBusy(false);
      if (!res || res.error) {
        setError("Couldn't sign in. Check your password and try again.");
        return;
      }
      router.replace(`/dashboard/${loc.code}`);
    },
    [email, password, router],
  );

  /** location fallback — step 1: legacy location credentials. */
  const submitLocationCreds = useCallback(
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
        setLocationId(list.length === 1 ? list[0].id : "");
        setPin("");
        setStep("pin");
      } finally {
        setBusy(false);
      }
    },
    [email, password],
  );

  /** location fallback — step 2: PIN. */
  const submitLocationPin = useCallback(
    async (value: string, locId: string) => {
      if (!locId) {
        setError("Pick a location first.");
        return;
      }
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
      router.replace(chosen ? `/dashboard/${chosen.code}` : (fromParam ?? "/"));
    },
    [email, password, locations, fromParam, router],
  );

  /** switch mode — PIN-only employee change at the current location. */
  const submitSwitchPin = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      const prep = await fetch("/api/pos/auth/switch-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      if (!prep.ok) {
        setBusy(false);
        const d = await prep.json().catch(() => ({}));
        setError(d.message ?? "That PIN didn't match an employee here.");
        setPin("");
        return;
      }
      const pj = (await prep.json()) as { lcode?: string };
      const res = await signIn("switch", { redirect: false });
      setBusy(false);
      if (!res || res.error) {
        setError("Couldn't switch employee. Try again.");
        setPin("");
        return;
      }
      router.replace(`/dashboard/${pj.lcode ?? switchLcode ?? ""}`);
    },
    [router, switchLcode],
  );

  // Keypad helpers (shared by location PIN + switch).
  const isPinScreen = mode === "switch" || (mode === "location" && step === "pin");
  const tapDigit = useCallback((d: string) => {
    setPin((prev) => (prev + d).slice(0, 4));
  }, []);
  const tapBackspace = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  const submitPin = useCallback(
    (value: string) => {
      if (value.length !== 4) {
        setError("Enter all 4 digits.");
        return;
      }
      if (mode === "switch") void submitSwitchPin(value);
      else void submitLocationPin(value, locationId);
    },
    [mode, locationId, submitSwitchPin, submitLocationPin],
  );

  useEffect(() => {
    if (!isPinScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        tapDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        tapBackspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        submitPin(pinRef.current);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPin("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPinScreen, busy, tapDigit, tapBackspace, submitPin]);

  const keypadDisabled =
    busy || (mode === "location" && step === "pin" && !locationId);

  return (
    <main className="min-h-screen grid lg:grid-cols-2 bg-carbon-bg">
      <aside
        className="hidden lg:flex flex-col justify-center p-12 text-white relative overflow-hidden"
        style={{
          backgroundColor: "#06122a",
          backgroundImage: "url(/login-brand-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "right center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="absolute inset-0 bg-black/30 pointer-events-none" aria-hidden />
        <div className="relative z-10">
          <h1 className="carbon-wordmark text-[5.25rem] font-black tracking-tight leading-[1.0] text-white">
            CarbonPOS.
          </h1>
          <h2
            className="text-6xl font-bold tracking-tight leading-[1.05] mt-2"
            style={{ color: "#7B9CE8" }}
          >
            Sell sharp. Move fast.
          </h2>
          <div className="mt-6 h-[3px] w-16" style={{ background: "#7B9CE8" }} aria-hidden />
          <p className="mt-6 text-2xl opacity-90 max-w-xl leading-snug">
            The modern POS built for speed,
            <br />
            precision, and performance.
          </p>
        </div>
        <p className="absolute bottom-8 left-12 right-12 z-10 text-xs opacity-70">
          © Carbon Jeans Company. All rights reserved.
        </p>
      </aside>

      <section className="relative flex items-center justify-center p-6">
        <div className="relative w-full max-w-md">
          <div
            className="absolute left-1/2 -top-10 -translate-x-1/2 w-20 h-20 rounded-full bg-white border border-carbon-border-soft shadow-md flex items-center justify-center z-10"
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="Carbon" className="w-12 h-12 object-cover rounded-full" />
          </div>

          <div className="carbon-card w-full p-6 sm:p-10 pt-12 sm:pt-14">
            {/* ---- PASSWORD MODE: creds ---- */}
            {mode === "password" && step === "creds" && (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-center mb-1">
                  Sign in
                </h1>
                <p className="text-carbon-text-muted text-sm text-center mb-8">
                  Use your email and POS password.
                </p>
                <form onSubmit={submitPasswordCreds} className="flex flex-col gap-4">
                  <CredField
                    icon="mail"
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="name@yourstore.com"
                    autoFocus
                  />
                  <PasswordField
                    value={password}
                    onChange={setPassword}
                    show={showPassword}
                    onToggle={() => setShowPassword((v) => !v)}
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="carbon-btn-primary tap-lg w-full text-base mt-2 inline-flex items-center justify-center gap-2"
                  >
                    {busy ? "Signing in…" : "Sign in"}
                  </button>
                </form>
                <button
                  className="w-full mt-6 text-xs uppercase tracking-wider font-bold text-carbon-text-muted hover:text-carbon-text"
                  onClick={() => {
                    setMode("location");
                    setStep("creds");
                    setError(null);
                    setPassword("");
                  }}
                >
                  Use location login instead
                </button>
              </>
            )}

            {/* ---- PASSWORD MODE: pick location ---- */}
            {mode === "password" && step === "pick" && (
              <>
                <h1 className="text-2xl font-bold tracking-tight mb-1">Choose location</h1>
                <p className="text-carbon-text-muted text-sm mb-6">
                  Your login has access to more than one store.
                </p>
                <div className="grid gap-2">
                  {locations.map((l) => (
                    <button
                      key={l.id}
                      disabled={busy}
                      onClick={() => finishPassword(l)}
                      className="carbon-btn-secondary tap-lg w-full text-left px-4 font-semibold"
                    >
                      {l.code} · {l.name}
                    </button>
                  ))}
                </div>
                <button
                  className="w-full mt-6 text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
                  onClick={() => {
                    setStep("creds");
                    setError(null);
                  }}
                >
                  ← Back
                </button>
              </>
            )}

            {/* ---- SWITCH MODE: PIN ---- */}
            {mode === "switch" && (
              <>
                <h1 className="text-2xl font-bold tracking-tight mb-1">Change employee</h1>
                <p className="text-carbon-text-muted text-sm mb-6">
                  Enter your 4-digit PIN to take over this register.
                </p>
                <PinPad
                  pin={pin}
                  disabled={busy}
                  busy={busy}
                  onDigit={tapDigit}
                  onClear={() => setPin("")}
                  onEnter={() => submitPin(pin)}
                />
              </>
            )}

            {/* ---- LOCATION FALLBACK: creds ---- */}
            {mode === "location" && step === "creds" && (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-center mb-1">
                  Location sign in
                </h1>
                <p className="text-carbon-text-muted text-sm text-center mb-8">
                  Enter the credentials your admin set for this location.
                </p>
                <form onSubmit={submitLocationCreds} className="flex flex-col gap-4">
                  <CredField
                    icon="mail"
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="name@yourstore.com"
                    autoFocus
                  />
                  <PasswordField
                    value={password}
                    onChange={setPassword}
                    show={showPassword}
                    onToggle={() => setShowPassword((v) => !v)}
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="carbon-btn-primary tap-lg w-full text-base mt-2 inline-flex items-center justify-center gap-2"
                  >
                    {busy ? "Signing in…" : "Continue"}
                  </button>
                </form>
                <button
                  className="w-full mt-6 text-xs uppercase tracking-wider font-bold text-carbon-text-muted hover:text-carbon-text"
                  onClick={() => {
                    setMode("password");
                    setStep("creds");
                    setError(null);
                    setPassword("");
                  }}
                >
                  ← Back to password sign in
                </button>
              </>
            )}

            {/* ---- LOCATION FALLBACK: PIN ---- */}
            {mode === "location" && step === "pin" && (
              <>
                <h1 className="text-2xl font-bold tracking-tight mb-1">Cashier PIN</h1>
                <p className="text-carbon-text-muted text-sm mb-6">
                  {locations.length > 1
                    ? "Pick a location, then tap your 4-digit PIN."
                    : `Signing in to ${locations[0]?.code} · ${locations[0]?.name}.`}
                </p>
                {locations.length > 1 && (
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
                )}
                <PinPad
                  pin={pin}
                  disabled={keypadDisabled}
                  busy={busy}
                  onDigit={tapDigit}
                  onClear={() => setPin("")}
                  onEnter={() => submitPin(pin)}
                />
                <button
                  className="w-full mt-6 text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
                  onClick={() => {
                    setStep("creds");
                    setPin("");
                    setError(null);
                  }}
                >
                  ← Use a different email
                </button>
              </>
            )}

            {error && (
              <p className="mt-6 text-center text-carbon-danger text-sm">{error}</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function CredField({
  icon,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  icon: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted mb-2">
        {label}
      </label>
      <div className="relative">
        <span
          className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-carbon-text-muted text-[18px] pointer-events-none"
          aria-hidden
        >
          {icon}
        </span>
        <input
          type={type}
          required
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="carbon-input tap w-full !pl-12"
        />
      </div>
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  show,
  onToggle,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-bold text-carbon-text-muted mb-2">
        Password
      </label>
      <div className="relative">
        <span
          className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-carbon-text-muted text-[18px] pointer-events-none"
          aria-hidden
        >
          lock
        </span>
        <input
          type={show ? "text" : "password"}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter your password"
          className="carbon-input tap w-full !pl-12 !pr-12"
        />
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-carbon-text-muted hover:text-carbon-text"
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden>
            {show ? "visibility_off" : "visibility"}
          </span>
        </button>
      </div>
    </div>
  );
}

function PinPad({
  pin,
  disabled,
  busy,
  onDigit,
  onClear,
  onEnter,
}: {
  pin: string;
  disabled: boolean;
  busy: boolean;
  onDigit: (d: string) => void;
  onClear: () => void;
  onEnter: () => void;
}) {
  return (
    <>
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
          disabled ? "opacity-50 pointer-events-none" : ""
        }`}
        aria-disabled={disabled}
      >
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            className="tap-lg carbon-btn-secondary text-2xl font-semibold"
            onClick={() => onDigit(d)}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          className="tap-lg carbon-btn-ghost text-carbon-text-muted text-sm font-semibold uppercase tracking-wider"
          onClick={onClear}
        >
          Clear
        </button>
        <button
          type="button"
          disabled={disabled}
          className="tap-lg carbon-btn-secondary text-2xl font-semibold"
          onClick={() => onDigit("0")}
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled || pin.length !== 4}
          className="tap-lg carbon-btn-primary text-sm font-bold uppercase tracking-wider"
          onClick={onEnter}
        >
          {busy ? "…" : "Enter"}
        </button>
      </div>
      <p className="text-[11px] text-carbon-text-muted text-center mt-3 uppercase tracking-wider">
        You can also type your PIN on the keyboard.
      </p>
    </>
  );
}
