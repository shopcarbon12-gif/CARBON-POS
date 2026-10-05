/**
 * Default return policy, used on the paper receipt, the PDF email
 * receipt and the legacy ESC/POS path whenever a location has no policy
 * of its own (Settings → Locations → Return policy). First line is the
 * headline.
 */
export const DEFAULT_RETURN_POLICY = [
  "NO REFUNDS — EXCHANGE ONLY",
  "Exchanges accepted within 14 days of purchase.",
  "Items must be unworn, unused, with original tags attached,",
  "and accompanied by the original receipt.",
].join("\n");

export function returnPolicyOf(stored: string | null | undefined): string {
  return stored && stored.trim() ? stored.trim() : DEFAULT_RETURN_POLICY;
}
