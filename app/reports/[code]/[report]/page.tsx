import Link from "next/link";
import { notFound } from "next/navigation";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { PrintButton } from "@/components/admin/PrintButton";
import {
  cellOf,
  formatCell,
  REPORTS,
  reportContext,
  type Section,
} from "@/lib/reports";

/**
 * Renders any Reports-tab report defined in lib/reports.ts: date range
 * (store-local days), summary tiles, one or more tables with totals,
 * links to sales / register sessions, CSV download and print.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; report: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { code, report } = await params;
  const def = REPORTS[report];
  if (!def) notFound();
  const cashier = await pageGuard(
    code,
    { tab: "reports", from: `/reports/${code}/${report}` },
    { requireRole: ["manager", "admin"] },
  );
  const sp = await searchParams;
  const c = await reportContext(def, code, cashier.lid, sp);
  if (!c) notFound();
  const result = await def.run(c);
  const qs = `from=${c.from}&to=${c.to}`;
  const today = new Date(`${c.to}T12:00:00Z`);
  const shift = (days: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const presets: Array<[string, string, string]> = [
    ["Day", c.to, c.to],
    ["Last 7 days", shift(-6), c.to],
    ["Month", `${c.to.slice(0, 8)}01`, c.to],
  ];

  return (
    <AdminShell
      email={cashier.email}
      active="reports"
      code={code}
      title={def.title}
      rightSlot={
        <div className="flex gap-2 print:hidden">
          <PrintButton />
          <a
            href={`/api/pos/reports/${def.slug}?${qs}`}
            className="carbon-btn-primary tap px-4 flex items-center justify-center text-sm uppercase tracking-wider font-bold"
          >
            Download CSV
          </a>
        </div>
      }
    >
      <div className="px-4 sm:px-8 py-6 border-b border-carbon-border-soft bg-carbon-surface">
        <Link
          href={`/reports/${code}`}
          className="text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline print:hidden"
        >
          ← All reports
        </Link>
        <h2 className="text-2xl font-bold mt-2 tracking-tight">{def.title}</h2>
        <p className="text-sm text-carbon-text-muted mt-1">{def.description}</p>
        <p className="text-sm font-semibold mt-1">
          {formatCell(c.from, "date", c.tz)}
          {c.from !== c.to ? ` – ${formatCell(c.to, "date", c.tz)}` : ""}
        </p>
      </div>

      <div className="p-4 sm:p-8">
        <form className="carbon-card p-5 mb-5 flex gap-3 items-end flex-wrap print:hidden">
          <label className="text-xs font-medium">
            <span className="block mb-1">From</span>
            <input
              type="date"
              name="from"
              defaultValue={c.from}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
            />
          </label>
          <label className="text-xs font-medium">
            <span className="block mb-1">To</span>
            <input
              type="date"
              name="to"
              defaultValue={c.to}
              className="tap rounded-lg border border-[var(--color-pos-border)] px-3"
            />
          </label>
          <button
            type="submit"
            className="tap rounded-xl bg-[var(--color-pos-ink)] text-white font-semibold px-4"
          >
            Run report
          </button>
          <div className="flex gap-2 ml-auto flex-wrap">
            {presets.map(([label, f, t]) => (
              <Link
                key={label}
                href={`/reports/${code}/${def.slug}?from=${f}&to=${t}`}
                className="tap rounded-xl border border-[var(--color-pos-border)] px-3 flex items-center text-sm font-semibold bg-white"
              >
                {label}
              </Link>
            ))}
          </div>
        </form>

        {result.stats && result.stats.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {result.stats.map((s) => (
              <div key={s.label} className="carbon-card p-4">
                <p className="text-xs uppercase tracking-wider font-bold text-carbon-text-muted">
                  {s.label}
                </p>
                <p className="text-2xl font-bold tabular-nums mt-1">
                  {formatCell(s.value, s.kind, c.tz)}
                </p>
              </div>
            ))}
          </div>
        )}

        <div
          className={
            result.sections.length > 1 ? "grid grid-cols-1 xl:grid-cols-2 gap-6" : ""
          }
        >
          {result.sections.map((sec, i) => (
            <SectionTable
              key={i}
              sec={sec}
              tz={c.tz}
              wide={sec.columns.length > 4}
            />
          ))}
        </div>

        {result.note && (
          <p className="text-xs text-carbon-text-muted mt-4">{result.note}</p>
        )}
      </div>
    </AdminShell>
  );
}

function SectionTable({ sec, tz, wide }: { sec: Section; tz: string; wide: boolean }) {
  const right = (k?: string) =>
    k === "money" || k === "int" || k === "pct" ? "text-right tabular-nums" : "";
  return (
    <div className={wide ? "xl:col-span-2" : ""}>
      {sec.title && <h3 className="font-semibold mb-2">{sec.title}</h3>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-[var(--color-pos-border)] bg-white">
          <thead className="bg-[var(--color-pos-bg)]">
            <tr className="text-left">
              {sec.columns.map((col) => (
                <th key={col.key} className={`px-3 py-2 whitespace-nowrap ${right(col.kind)}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sec.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={sec.columns.length}
                  className="px-3 py-6 text-center text-[var(--color-pos-muted)]"
                >
                  {sec.empty ?? "No data in this range."}
                </td>
              </tr>
            ) : (
              sec.rows.map((row, i) => (
                <tr key={i} className="border-t border-[var(--color-pos-border)]">
                  {sec.columns.map((col) => {
                    const text = formatCell(cellOf(row, col.key), col.kind, tz);
                    const href = row._links?.[col.key];
                    return (
                      <td key={col.key} className={`px-3 py-2 ${right(col.kind)}`}>
                        {href ? (
                          <Link href={href} className="text-carbon-blue font-semibold hover:underline">
                            {text}
                          </Link>
                        ) : (
                          text
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {sec.totals && sec.rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--color-pos-ink)] font-bold bg-[var(--color-pos-bg)]">
                {sec.columns.map((col) => (
                  <td key={col.key} className={`px-3 py-2 ${right(col.kind)}`}>
                    {sec.totals![col.key] === undefined
                      ? ""
                      : formatCell(cellOf(sec.totals!, col.key), col.kind, tz)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
