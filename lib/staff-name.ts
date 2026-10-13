/**
 * Employee display names — owner rule: everywhere an EMPLOYEE name is shown
 * (receipts, emails, register UI, slips…) use first name + last initial,
 * e.g. "Julian Perez" → "Julian P.". REPORTS (pages under /reports, report
 * CSV exports, Z-report / EOD) keep the full name — do not use these there.
 *
 * Display only: never write the shortened value back to the database.
 * Customer names are NOT affected by this rule.
 */

/**
 * "Julian Perez" → "Julian P."; "Julian Carlos de la Cruz" → "Julian C."
 * (first token + initial of the LAST token); "Julian" → "Julian".
 * Collapses extra whitespace. Null / empty / emails are returned as-is
 * (an email fallback is not a person's name, so it is not split).
 */
export function shortStaffName(full: string): string;
export function shortStaffName(full: string | null): string | null;
export function shortStaffName(full: string | null | undefined): string | null | undefined;
export function shortStaffName(full: string | null | undefined): string | null | undefined {
  if (full == null) return full;
  const s = String(full).trim().replace(/\s+/g, " ");
  if (!s || s.includes("@")) return full;
  const parts = s.split(" ");
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1].replace(/^[^\p{L}\p{N}]+/u, "");
  if (!last) return parts[0];
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

/**
 * Same rule when first / last are stored separately. Uses the first token
 * of `firstName` and the initial of the last token of `lastName`. Falls back
 * to whatever's available, then to `fallback` (typically the email) so a row
 * never renders blank.
 */
export function shortStaffNameParts(
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string | null,
): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (f || l) return shortStaffName(`${f} ${l}`.trim());
  return (fallback ?? "").trim();
}
