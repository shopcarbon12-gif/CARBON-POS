import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-[var(--color-pos-border)] p-10 w-full max-w-md text-center">
        <h1 className="text-3xl font-bold mb-2">Carbon POS</h1>
        <p className="text-[var(--color-pos-muted)] mb-8">
          Where would you like to go?
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/pos/register"
            className="tap-lg flex items-center justify-center rounded-xl bg-[var(--color-pos-accent)] text-white text-lg font-semibold"
          >
            Open the Register
          </Link>
          <Link
            href="/admin"
            className="tap flex items-center justify-center rounded-xl border border-[var(--color-pos-border)] text-[var(--color-pos-ink)] font-medium"
          >
            Back Office
          </Link>
        </div>
      </div>
    </main>
  );
}
