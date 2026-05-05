"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Two-mode sign-in. Cashiers tap a 4-digit PIN; managers/admins switch to
 * email + password to enter the back office.
 *
 * useSearchParams() needs a Suspense boundary in Next 16 static rendering —
 * the inner component reads `from`, the outer wraps it.
 */
export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-[var(--color-pos-muted)]">Loading…</p>
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

  async function submitPin(value: string) {
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
  }

  function tapDigit(d: string) {
    if (busy) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) submitPin(next);
  }

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
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl shadow-sm w-full max-w-md p-8">
        <h1 className="text-2xl font-bold mb-1">Carbon POS</h1>
        <p className="text-[var(--color-pos-muted)] mb-6">
          {mode === "pin"
            ? "Tap your 4-digit PIN to start your shift."
            : "Sign in to the back office."}
        </p>

        {mode === "pin" ? (
          <>
            <div className="flex gap-3 justify-center mb-6">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 ${
                    i < pin.length
                      ? "bg-[var(--color-pos-ink)] border-[var(--color-pos-ink)]"
                      : "border-[var(--color-pos-border)]"
                  }`}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  className="tap-lg rounded-xl bg-[var(--color-pos-bg)] border border-[var(--color-pos-border)] text-2xl font-semibold active:bg-zinc-200"
                  onClick={() => tapDigit(d)}
                >
                  {d}
                </button>
              ))}
              <button
                className="tap-lg rounded-xl text-[var(--color-pos-muted)]"
                onClick={() => setPin("")}
              >
                Clear
              </button>
              <button
                className="tap-lg rounded-xl bg-[var(--color-pos-bg)] border border-[var(--color-pos-border)] text-2xl font-semibold active:bg-zinc-200"
                onClick={() => tapDigit("0")}
              >
                0
              </button>
              <button
                className="tap-lg rounded-xl text-[var(--color-pos-muted)]"
                onClick={() => setPin(pin.slice(0, -1))}
              >
                ←
              </button>
            </div>
            <button
              className="w-full mt-6 text-sm text-[var(--color-pos-muted)] underline"
              onClick={() => setMode("password")}
            >
              Manager? Sign in with email and password
            </button>
          </>
        ) : (
          <form onSubmit={submitPassword} className="flex flex-col gap-3">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
            />
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
            />
            <button
              type="submit"
              disabled={busy}
              className="tap-lg rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold mt-2"
            >
              {busy ? "Signing in..." : "Sign in"}
            </button>
            <button
              type="button"
              className="text-sm text-[var(--color-pos-muted)] underline mt-1"
              onClick={() => setMode("pin")}
            >
              Cashier? Use the PIN keypad
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 text-center text-[var(--color-pos-danger)] text-sm">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
