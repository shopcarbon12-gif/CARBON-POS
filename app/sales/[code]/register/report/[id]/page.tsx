import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { RegisterReportPanel } from "@/components/pos/RegisterReportPanel";

/**
 * Landing screen right after Open Register (?type=open) or Close
 * Register (?type=eod). Prints the report automatically and lets the
 * cashier reprint before moving on. Every report stays available under
 * Reports → Register Reports.
 */
export default async function RegisterReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { code, id } = await params;
  const { type } = await searchParams;
  const cashier = await pageGuard(code, {
    tab: "sales",
    from: `/sales/${code}/register/report/${id}`,
  });
  const kind = type === "eod" ? "eod" : "open";

  return (
    <AdminShell
      email={cashier.email}
      active="sales"
      code={code}
      title={kind === "open" ? "Register Opened" : "Register Closed"}
    >
      <section className="p-6 max-w-3xl mx-auto">
        <RegisterReportPanel
          sessionId={Number(id)}
          kinds={[kind]}
          autoPrint
          continueHref={kind === "open" ? `/sales/${code}/new` : `/sales/${code}`}
          continueLabel={kind === "open" ? "Start Selling" : "Done"}
        />
      </section>
    </AdminShell>
  );
}
