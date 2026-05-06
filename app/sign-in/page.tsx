"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Two-mode sign-in. Cashiers tap a 4-digit PIN; managers/admins switch to
 * email + password to enter the back office. Carbon-themed split screen:
 * brand panel left, auth card right.
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
  const from = params.get("from") || "/pos/register";
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The PIN keypad now requires the user to press Enter (or hit the Enter key
  // on a hardware keyboard) once 4 digits are entered, instead of auto-
  // submitting. Backspace deletes the last digit; Clear wipes the field.
  const pinRef = useRef(pin);
  pinRef.current = pin;

  const submitPin = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      const res = await signIn("pin", { pin: value, redirect: false });
      setBusy(false);
      if (res?.error) {
        setError("That PIN doesn't match. Try again.");
        setPin("");
        return;
      }
      router.replace(from);
    },
    [from, router],
  );

  const tapDigit = useCallback((d: string) => {
    setPin((prev) => (prev + d).slice(0, 4));
  }, []);

  const tapEnter = useCallback(() => {
    const v = pinRef.current;
    if (v.length !== 4) {
      setError("Enter all 4 digits, then press Enter.");
      return;
    }
    void submitPin(v);
  }, [submitPin]);

  const tapBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);

  // Hardware keyboard support on the PIN screen — digits append, Backspace
  // deletes, Enter submits, Escape clears.
  useEffect(() => {
    if (mode !== "pin") return;
    function onKey(e: KeyboardEvent) {
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
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, busy, tapDigit, tapBackspace, tapEnter]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn("password", {
      email,
      password,
      redirect: false,
    });
    setBusy(false);
    if (res?.error) {
      setError("Email or password didn't match.");
      return;
    }
    router.replace("/admin");
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-2 bg-carbon-bg">
      {/* Brand panel — solid Carbon Blue with the wordmark. Visible on lg+. */}
      <aside
        className="hidden lg:flex flex-col justify-between p-12 text-white"
        style={{ background: "var(--carbon-blue)" }}
      >
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 bg-white text-carbon-blue font-bold text-xl flex items-center justify-center">
            C
          </span>
          <span className="text-xl font-bold tracking-tight">Carbon</span>
        </div>
        <div>
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            Carbon POS.
            <br />
            <span className="opacity-70">Sell sharp. Move fast.</span>
          </h2>
          <p className="mt-4 text-sm opacity-80 max-w-md">
            High-end retail point of sale, paired tightly with CarbonWMS and
            your Stripe Terminal hardware.
          </p>
        </div>
        <p className="text-xs opacity-60">
          © Carbon Jeans Company. All rights reserved.
        </p>
      </aside>

      {/* Auth card. */}
      <section className="flex items-center justify-center p-6">
        <div className="carbon-card w-full max-w-md p-10">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <span className="w-10 h-10 bg-carbon-blue text-white font-bold text-xl flex items-center justify-center">
              C
            </span>
            <span className="text-xl font-bold">Carbon POS</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">
            {mode === "pin" ? "Cashier sign in" : "Back office sign in"}
          </h1>
          <p className="text-carbon-text-muted text-sm mb-8">
            {mode === "pin"
              ? "Tap your 4-digit PIN to start your shift."
              : "Sign in to manage products, employees, and reports."}
          </p>

          {mode === "pin" ? (
            <>
              <div className="flex gap-3 justify-center mb-8">
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
              <div className="grid grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={busy}
                    className="tap-lg carbon-btn-secondary text-2xl font-semibold"
                    onClick={() => tapDigit(d)}
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  className="tap-lg carbon-btn-ghost text-carbon-text-muted text-sm font-semibold uppercase tracking-wider"
                  onClick={() => setPin("")}
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="tap-lg carbon-btn-secondary text-2xl font-semibold"
                  onClick={() => tapDigit("0")}
                >
                  0
                </button>
                <button
                  type="button"
                  disabled={busy || pin.length !== 4}
                  className="tap-lg carbon-btn-primary text-sm font-bold uppercase tracking-wider"
                  onClick={tapEnter}
                >
                  {busy ? "…" : "Enter"}
                </button>
              </div>
              <p className="text-[11px] text-carbon-text-muted text-center mt-3 uppercase tracking-wider">
                You can also type your PIN on the keyboard.
              </p>
              <button
                className="w-full mt-8 text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
                onClick={() => setMode("password")}
              >
                Manager? Sign in with email and password
              </button>
            </>
          ) : (
            <form onSubmit={submitPassword} className="flex flex-col gap-4">
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
                {busy ? "Signing in…" : "Sign in"}
              </button>
              <button
                type="button"
                className="text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline mt-1"
                onClick={() => setMode("pin")}
              >
                Cashier? Use the PIN keypad
              </button>
            </form>
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
