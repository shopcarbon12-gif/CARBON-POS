import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-carbon-bg">
      <div className="carbon-card w-full max-w-md p-10 text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <span className="w-12 h-12 bg-carbon-blue text-white font-bold text-2xl flex items-center justify-center">
            C
          </span>
          <span className="text-2xl font-bold tracking-tight">Carbon POS</span>
        </div>
        <p className="text-carbon-text-muted mb-8 text-sm">
          Where would you like to go?
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/pos/register"
            className="carbon-btn-primary tap-lg flex items-center justify-center text-lg"
          >
            Open the Register
          </Link>
          <Link
            href="/admin"
            className="carbon-btn-secondary tap flex items-center justify-center"
          >
            Back Office
          </Link>
        </div>
      </div>
    </main>
  );
}
