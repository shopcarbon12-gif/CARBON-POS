import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { toCsv } from "@/lib/csv";
import { cellOf, csvCell, REPORTS, reportContext } from "@/lib/reports";

/**
 * GET /api/pos/reports/:report?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=json]
 * CSV download (default) of any Reports-tab report — built from the same
 * definition the page renders, for the signed-in store.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ report: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const def = REPORTS[(await ctx.params).report];
  if (!def) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const c = await reportContext(def, cashier.lcode ?? "", cashier.lid, {
    from: sp.get("from"),
    to: sp.get("to"),
  });
  if (!c) return NextResponse.json({ error: "no_location" }, { status: 404 });
  const result = await def.run(c);

  if (sp.get("format") === "json") {
    return NextResponse.json({ from: c.from, to: c.to, ...result });
  }

  const lines: Array<Array<string | number | null>> = [
    [def.title, `${c.from} to ${c.to}`],
    [],
  ];
  if (result.stats?.length) {
    for (const s of result.stats) {
      lines.push([s.label, s.kind === "int" ? s.value : s.value.toFixed(2)]);
    }
    lines.push([]);
  }
  for (const sec of result.sections) {
    if (sec.title) lines.push([sec.title]);
    lines.push(sec.columns.map((col) => col.header));
    for (const row of [...sec.rows, ...(sec.totals ? [sec.totals] : [])]) {
      lines.push(sec.columns.map((col) => csvCell(cellOf(row, col.key), col.kind, c.tz)));
    }
    lines.push([]);
  }
  return new Response(toCsv(lines), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${def.slug}-${c.from}-to-${c.to}.csv"`,
    },
  });
}
