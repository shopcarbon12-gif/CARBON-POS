import type { CartLine } from "@/types/pos";

/** Cart lines in the shape /api/pos/payment/capture expects. */
export function captureLines(lines: CartLine[]) {
  return lines.map((l) => ({
    sku_id: l.sku_id,
    epc: l.epc,
    epcs: l.epcs,
    source: l.source,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    discount_amount: l.discount_amount,
    tax_rate: l.tax_rate,
    line_type: l.line_type,
    attributed_employee_id: l.attributed_employee_id ?? null,
    promo_rule_id: l.discount_source === "promo" ? (l.promo_rule_id ?? null) : null,
    discount_approval: l.discount_approval ?? null,
  }));
}
