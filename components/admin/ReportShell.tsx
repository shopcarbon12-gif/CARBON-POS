import Link from "next/link";

/**
 * Page chrome for individual /admin/reports/* pages. Standardized header,
 * breadcrumb back to /admin/reports, and a grid for filters + table.
 */
export function ReportShell({
  title,
  description,
  filters,
  csvHref,
  children,
}: {
  title: string;
  description?: string;
  filters: React.ReactNode;
  csvHref?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[var(--color-pos-border)] px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/admin/reports"
            className="text-sm text-[var(--color-pos-muted)] underline"
          >
            ← All reports
          </Link>
          <h1 className="text-xl font-bold mt-1">{title}</h1>
          {description && (
            <p className="text-xs text-[var(--color-pos-muted)] mt-1">
              {description}
            </p>
          )}
        </div>
        {csvHref && (
          <a
            href={csvHref}
            className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-4"
          >
            Download CSV
          </a>
        )}
      </header>
      <div className="p-6">
        <div className="bg-white border border-[var(--color-pos-border)] rounded-2xl p-4 mb-4">
          {filters}
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * Helper that builds a query string from a Search Params record. Used to
 * link the "Download CSV" button to the same filter set the user is
 * currently looking at.
 */
export function qs(
  base: Record<string, string | undefined>,
  override: Record<string, string>,
): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === "string" && v.length > 0) u.set(k, v);
  }
  for (const [k, v] of Object.entries(override)) u.set(k, v);
  return u.toString();
}
