import { getPool } from "@/lib/db";

/**
 * Automatic promotions from Settings → Discounts (pos_discount_rules).
 * A rule applies when it's active, today is inside its date window (store
 * time), it's for this store (or all stores), and it targets the line:
 *   applies_to 'all'           → every product line
 *   applies_to 'sku_id'        → lines of that SKU
 *   applies_to 'customer_type' → every product line when the attached
 *                                customer carries that tag (e.g. "vip")
 * percent = % off the line; fixed = $ off per unit (capped at the line).
 * Rules marked "needs manager PIN" are never auto-applied — staff enter
 * them as a manual discount, which prompts for the PIN.
 * Each line gets its single best rule. Used by the sell screen and
 * re-checked by the capture route.
 */

export type PromoLine = {
  sku_id: string | null;
  unit_price: number;
  quantity: number;
  line_type: string;
};

export type PromoResult = { rule_id: number; name: string; discount: number } | null;

export async function evaluatePromotions(
  lid: string,
  customerId: number | null,
  lines: PromoLine[],
): Promise<PromoResult[]> {
  const pool = getPool();
  const rulesR = await pool.query(
    `SELECT dr.id, dr.name, dr.type, dr.value::float AS value, dr.applies_to, dr.applies_to_value
       FROM pos_discount_rules dr
       JOIN pos_locations pl ON pl.wms_location_id = $1::uuid
      WHERE dr.is_active
        AND NOT dr.requires_manager_pin
        AND (dr.pos_location_id IS NULL OR dr.pos_location_id = pl.id)
        AND (dr.start_date IS NULL OR dr.start_date <= (now() AT TIME ZONE COALESCE(pl.timezone,'America/New_York'))::date)
        AND (dr.end_date   IS NULL OR dr.end_date   >= (now() AT TIME ZONE COALESCE(pl.timezone,'America/New_York'))::date)`,
    [lid],
  );
  if (rulesR.rows.length === 0) return lines.map(() => null);

  let tags: string[] = [];
  if (customerId) {
    const c = await pool.query<{ tags: string[] | null }>(
      `SELECT tags FROM pos_customers WHERE id = $1`,
      [customerId],
    );
    tags = (c.rows[0]?.tags ?? []).map((t) => String(t).trim().toLowerCase());
  }

  return lines.map((l) => {
    if (l.line_type !== "product" || l.unit_price <= 0 || l.quantity <= 0) return null;
    const lineValue = l.unit_price * l.quantity;
    let best: PromoResult = null;
    for (const r of rulesR.rows) {
      const target = String(r.applies_to_value ?? "").trim().toLowerCase();
      const applies =
        r.applies_to === "all" ||
        (r.applies_to === "sku_id" && l.sku_id && target === l.sku_id.toLowerCase()) ||
        (r.applies_to === "customer_type" && target !== "" && tags.includes(target));
      if (!applies) continue;
      const raw = r.type === "percent" ? lineValue * (r.value / 100) : r.value * l.quantity;
      const discount = Math.round(Math.min(lineValue, Math.max(0, raw)) * 100) / 100;
      if (discount > 0 && (!best || discount > best.discount)) {
        best = { rule_id: r.id, name: r.name, discount };
      }
    }
    return best;
  });
}
