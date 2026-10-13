import type { Pool } from "pg";

/**
 * Store Replenishment — READ-ONLY view for the POS.
 *
 * The picking happens on the CarbonWMS handheld (Find & Locate → Store
 * Replenishment). The POS only shows whether each showroom sale has been
 * replenished: GREEN = every sold line that has stock has been ticked on the
 * handheld; grey = still open.
 *
 * The SQL mirrors carbon-warehouse-management/lib/server/store-replenishment.ts
 * (listReplenishmentSales) — same tables, same "complete" rule. Keep the two in
 * step if either changes.
 */

/** Only this location's showroom is replenished from the back (owner, 2026-10-12). */
export const REPLENISHMENT_LOCATION_CODE = "001";

export type ReplenishmentSale = {
  id: number;
  saleNumber: string;
  localDay: string;
  localTime: string;
  employee: string | null;
  customer: string | null;
  soldQty: number;
  pickableLines: number;
  pickedLines: number;
  complete: boolean;
};

export async function listReplenishmentSales(
  pool: Pool,
  locationId: string,
  range: { fromDate?: string | null; toDate?: string | null },
): Promise<ReplenishmentSale[]> {
  const r = await pool.query<{
    id: number;
    sale_number: string;
    local_day: string;
    local_time: string;
    employee: string | null;
    customer: string | null;
    sold_qty: number;
    pickable_lines: number;
    picked_lines: number;
  }>(
    `WITH facts AS (
       SELECT l.id AS line_id, l.sale_id, l.sku_id, l.quantity,
              (SELECT count(*)::int FROM items i
                WHERE i.custom_sku_id = l.sku_id AND i.location_id = $1::uuid AND i.status = 'in-stock') AS in_stock,
              p.sale_line_id IS NOT NULL AS picked
         FROM pos_sale_lines l
         LEFT JOIN store_replenishment_picks p ON p.sale_line_id = l.id
        WHERE coalesce(l.line_type, 'product') = 'product' AND l.quantity > 0
     )
     SELECT s.id, s.sale_number,
            upper(to_char(s.created_at AT TIME ZONE pl.timezone, 'Dy Mon FMDD, YYYY')) AS local_day,
            to_char(s.created_at AT TIME ZONE pl.timezone, 'FMHH12:MI AM') AS local_time,
            nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') AS employee,
            nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS customer,
            coalesce(sum(f.quantity), 0)::int AS sold_qty,
            count(*) FILTER (WHERE f.sku_id IS NOT NULL AND f.in_stock > 0)::int AS pickable_lines,
            count(*) FILTER (WHERE f.sku_id IS NOT NULL AND f.in_stock > 0 AND f.picked)::int AS picked_lines
       FROM pos_sales s
       JOIN pos_locations pl ON pl.id = s.pos_location_id AND pl.wms_location_id = $1::uuid
       LEFT JOIN pos_employees e ON e.id = coalesce(s.attributed_employee_id, s.cashier_id)
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN pos_customers c ON c.id = s.customer_id
       LEFT JOIN facts f ON f.sale_id = s.id
      WHERE s.status = 'completed' AND s.voided_at IS NULL
        AND (s.created_at AT TIME ZONE pl.timezone)::date
              BETWEEN coalesce($2::date, (now() AT TIME ZONE pl.timezone)::date)
                  AND coalesce($3::date, $2::date, (now() AT TIME ZONE pl.timezone)::date)
      GROUP BY s.id, pl.timezone, u.first_name, u.last_name, c.first_name, c.last_name
     HAVING coalesce(sum(f.quantity), 0) > 0
      ORDER BY s.created_at DESC
      LIMIT 500`,
    [locationId, range.fromDate ?? null, range.toDate ?? null],
  );
  return r.rows.map((x) => ({
    id: x.id,
    saleNumber: x.sale_number,
    localDay: x.local_day,
    localTime: x.local_time,
    employee: x.employee,
    customer: x.customer,
    soldQty: x.sold_qty,
    pickableLines: x.pickable_lines,
    pickedLines: x.picked_lines,
    complete: x.pickable_lines > 0 && x.picked_lines === x.pickable_lines,
  }));
}
