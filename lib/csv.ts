/**
 * Tiny CSV writer. Each row is an array of cells; cells are coerced to
 * strings, quoted when they contain , " \r or \n, and " inside cells is
 * doubled per RFC 4180. No streaming — these reports are small (≤ a few
 * thousand rows).
 */
export function toCsv(rows: Array<Array<string | number | null>>): string {
  const lines: string[] = [];
  for (const r of rows) {
    lines.push(r.map(cell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function cell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
