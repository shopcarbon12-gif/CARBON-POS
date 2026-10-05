/**
 * Discount policy shared by the sell screen (asks for a manager PIN) and
 * the capture route (enforces it). Any markdown — % off, $ off, sale-wide
 * share or a Set Price below the catalog price — beyond this fraction of
 * the line's catalog value needs a manager's approval, unless it comes
 * from an active promotion.
 */
export const MANAGER_APPROVAL_THRESHOLD = 0.2;

/** Fraction of `listPrice × qty` taken off (0..1). */
export function markdownFraction(l: {
  list_price?: number | null;
  unit_price: number;
  quantity: number;
  discount_amount: number;
}): number {
  const list = (l.list_price ?? l.unit_price) * l.quantity;
  if (list <= 0) return 0;
  const net = l.unit_price * l.quantity - l.discount_amount;
  return Math.max(0, (list - net) / list);
}

export function needsManagerApproval(fraction: number): boolean {
  return fraction > MANAGER_APPROVAL_THRESHOLD + 1e-4;
}
