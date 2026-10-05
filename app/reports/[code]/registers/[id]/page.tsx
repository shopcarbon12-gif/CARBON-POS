import Link from "next/link";
import { pageGuard } from "@/lib/page-guard";
import { AdminShell } from "@/components/admin/AdminShell";
import { RegisterReportPanel } from "@/components/pos/RegisterReportPanel";

/**
 * One saved register report from the Reports tab. ?type=open|eod picks
 * which one; without it both are shown side by side. Reprint buttons
 * send it to the store's receipt printer.
 */
export default async function RegisterReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { code, id } = await params;
  const { type } = await searchParams;
  const cashier = await pageGuard(code, {
    tab: "reports",
    from: `/reports/${code}/registers/${id}`,
  }, { requireRole: ["manager", "admin"] });
  const kinds: Array<"open" | "eod"> =
    type === "open" ? ["open"] : type === "eod" ? ["eod"] : ["open", "eod"];

  return (
    <AdminShell
      email={cashier.email}
      active="reports"
      code={code}
      title={`Register Report #${id}`}
    >
      <section className="p-6 max-w-5xl">
        <Link
          href={`/reports/${code}/registers`}
          className="text-xs uppercase tracking-wider font-bold text-carbon-blue hover:underline"
        >
          ← Register Reports
        </Link>
        <div className="mt-4">
          <RegisterReportPanel sessionId={Number(id)} kinds={kinds} />
        </div>
      </section>
    </AdminShell>
  );
}
