import Link from "next/link";
import { currentCashier } from "@/lib/session";
import { AdminShell } from "./AdminShell";

/**
 * Page chrome for individual /admin/reports/* pages. Renders inside the
 * shared Carbon AdminShell so every page in the back office wears the same
 * sidebar + topbar — and exposes a per-page header strip with a back link
 * to the reports index plus an optional CSV download.
 */
export async function ReportShell({
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
  const cashier = await currentCashier();
  return (
    <AdminShell
      email={cashier?.email ?? null}
      active="reports"
      title="Reports"
      rightSlot={
        csvHref ? (
          <a
            href={csvHref}
            className="carbon-btn-primary tap px-4 flex items-center justify-center text-sm uppercase tracking-wider font-bold"
          >
            Download CSV
          </a>
        ) : null
      }
    >
      <div className="px-8 py-6 border-b border-carbon-border-soft bg-carbon-surface">
        <Link
          href="/admin/reports"
          className="text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
        >
          ← All reports
        </Link>
        <h2 className="text-2xl font-bold mt-2 tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-carbon-text-muted mt-1">{description}</p>
        )}
      </div>
      <div className="p-8">
        <div className="carbon-card p-5 mb-5">{filters}</div>
        {children}
      </div>
    </AdminShell>
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
