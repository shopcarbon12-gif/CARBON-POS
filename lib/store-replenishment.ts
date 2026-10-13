import type { Pool } from "pg";
import { shortStaffName } from "@/lib/staff-name";

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
    employee: shortStaffName(x.employee),
    customer: x.customer,
    soldQty: x.sold_qty,
    pickableLines: x.pickable_lines,
    pickedLines: x.picked_lines,
    complete: x.pickable_lines > 0 && x.picked_lines === x.pickable_lines,
  }));
}

export type ReplenishmentLine = {
  lineId: number;
  sku: string | null;
  name: string;
  color: string | null;
  size: string | null;
  bin: string | null;
  soldQty: number;
  inStock: number;
  pickable: boolean;
  picked: boolean;
  pickedBy: string | null;
  pickedAt: string | null;
};

/**
 * One sale's items, in the handheld's pick order (with stock first, then bin,
 * then name). Mirrors the WMS getReplenishmentLines. Read-only.
 */
export async function getReplenishmentLines(
  pool: Pool,
  locationId: string,
  saleId: number,
): Promise<ReplenishmentLine[] | null> {
  const owner = await pool.query(
    `SELECT 1 FROM pos_sales s
       JOIN pos_locations pl ON pl.id = s.pos_location_id AND pl.wms_location_id = $1::uuid
      WHERE s.id = $2 AND s.status = 'completed' AND s.voided_at IS NULL`,
    [locationId, saleId],
  );
  if (!owner.rowCount) return null;
  const r = await pool.query<{
    line_id: number;
    sku: string | null;
    name: string | null;
    description: string | null;
    color: string | null;
    size: string | null;
    bin: string | null;
    quantity: number;
    in_stock: number;
    has_sku: boolean;
    picked: boolean;
    picked_by_name: string | null;
    picked_at: Date | null;
  }>(
    `SELECT l.id AS line_id, cs.sku, m.description AS name, l.description, cs.color_code AS color, cs.size,
            l.quantity, l.sku_id IS NOT NULL AS has_sku,
            (SELECT count(*)::int FROM items i
              WHERE i.custom_sku_id = l.sku_id AND i.location_id = $1::uuid AND i.status = 'in-stock') AS in_stock,
            coalesce(
              (SELECT b.code FROM items i JOIN bins b ON b.id = i.bin_id
                WHERE i.custom_sku_id = l.sku_id AND i.location_id = $1::uuid AND i.status = 'in-stock'
                GROUP BY b.code ORDER BY count(*) DESC, b.code LIMIT 1),
              ab.code
            ) AS bin,
            p.sale_line_id IS NOT NULL AS picked, p.picked_by_name, p.picked_at
       FROM pos_sale_lines l
       LEFT JOIN custom_skus cs ON cs.id = l.sku_id
       LEFT JOIN matrices m ON m.id = cs.matrix_id
       LEFT JOIN bins ab ON ab.id = cs.assigned_bin_id
       LEFT JOIN store_replenishment_picks p ON p.sale_line_id = l.id
      WHERE l.sale_id = $2 AND coalesce(l.line_type, 'product') = 'product' AND l.quantity > 0`,
    [locationId, saleId],
  );
  const lines = r.rows.map((x) => ({
    lineId: x.line_id,
    sku: x.sku,
    name: x.name || x.description || "Item",
    color: x.color,
    size: x.size,
    bin: x.bin,
    soldQty: x.quantity,
    inStock: x.in_stock,
    pickable: x.has_sku && x.in_stock > 0,
    picked: x.picked,
    pickedBy: shortStaffName(x.picked_by_name),
    pickedAt: x.picked_at ? x.picked_at.toISOString() : null,
  }));
  lines.sort(
    (a, b) =>
      Number(b.pickable) - Number(a.pickable) ||
      (a.bin ?? "\uffff").localeCompare(b.bin ?? "\uffff") ||
      a.name.localeCompare(b.name) ||
      a.lineId - b.lineId,
  );
  return lines;
}
