import { ReportShell } from "./ReportShell";

/**
 * Server-rendered date-range report. The page passes:
 *   - title/description
 *   - the API endpoint slug (e.g. "sales-tax")
 *   - the column definitions
 *   - the rows already fetched from the DB
 *
 * The "Download CSV" button hits the same endpoint with format=csv plus
 * the current from/to query params.
 */
export type Column = {
  header: string;
  align?: "left" | "right";
  /** Stable key into the row record. */
  key: string;
};

export function DateRangeReport({
  title,
  description,
  endpoint,
  from,
  to,
  rows,
  columns,
  extraFilters,
}: {
  title: string;
  description?: string;
  endpoint: string;
  from: string;
  to: string;
  rows: Array<Record<string, string | number | null>>;
  columns: Column[];
  extraFilters?: React.ReactNode;
}) {
  const csvHref = `/api/pos/reports/${endpoint}?from=${encodeURIComponent(
    from,
  )}&to=${encodeURIComponent(to)}&format=csv`;
  return (
    <ReportShell
      title={title}
      description={description}
      csvHref={csvHref}
      filters={
        <form className="flex gap-3 items-end flex-wrap">
          <Field label="From">
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
            />
          </Field>
          {extraFilters}
          <button
            type="submit"
            className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-4"
          >
            Run report
          </button>
        </form>
      }
    >
      <table className="w-full text-sm border border-[var(--color-pos-border)] rounded-xl overflow-hidden">
        <thead className="bg-[var(--color-pos-bg)]">
          <tr className="text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
              >
                No data in this range.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-t border-[var(--color-pos-border)]">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${
                      c.align === "right" ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {format(r[c.key])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </ReportShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-xs font-medium">
      <span className="block mb-1">{label}</span>
      {children}
    </label>
  );
}

function format(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return String(v);
}
