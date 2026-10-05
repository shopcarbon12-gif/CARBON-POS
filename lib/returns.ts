import type { PoolClient } from "pg";

/**
 * Shared "items came back" steps used by refunds and exchanges, inside
 * the caller's transaction.
 */

/**
 * Flip the returned pieces back to 'in-stock': every tag on `lineIds`
 * (or the whole sale when lineIds is empty and the sale is now fully
 * refunded). Only tags still 'sold' flip; one STATUS_CHANGE audit row per
 * flipped EPC, mirroring capture.
 */
export async function restockReturnedLines(
  client: PoolClient,
  a: {
    saleId: number;
    lineIds: number[];
    fullyRefunded: boolean;
    tenantId: string;
    userId: string;
    reason: "pos_refund" | "pos_exchange";
  },
): Promise<number> {
  const epcRes =
    a.lineIds.length > 0
      ? await client.query<{ epc: string | null }>(
          `SELECT DISTINCT unnest(COALESCE(epcs, ARRAY[epc])) AS epc
             FROM pos_sale_lines
            WHERE sale_id = $1 AND id = ANY($2::int[])`,
          [a.saleId, a.lineIds],
        )
      : a.fullyRefunded
        ? await client.query<{ epc: string | null }>(
            `SELECT DISTINCT unnest(COALESCE(epcs, ARRAY[epc])) AS epc
               FROM pos_sale_lines
              WHERE sale_id = $1`,
            [a.saleId],
          )
        : { rows: [] as Array<{ epc: string | null }> };
  const epcs = epcRes.rows.map((r) => r.epc).filter((e): e is string => !!e);
  if (epcs.length === 0) return 0;
  const flipped = await client.query<{ epc: string; old_status: string }>(
    `WITH prev AS (
       SELECT epc, status AS old_status
         FROM items
        WHERE epc = ANY($1::text[])
     )
     UPDATE items i
        SET status = 'in-stock'
       FROM prev p
      WHERE i.epc = p.epc
        AND i.status = 'sold'
     RETURNING i.epc, p.old_status`,
    [epcs],
  );
  for (const r of flipped.rows) {
    await client.query(
      `INSERT INTO inventory_audit_logs
         (tenant_id, log_type, entity_type, entity_reference,
          old_value, new_value, reason, user_id, user_uuid)
       VALUES ($1::uuid, 'STATUS_CHANGE', 'EPC', $2, $3, 'in-stock',
               $4, NULL, $5::uuid)`,
      [a.tenantId, r.epc, r.old_status, a.reason, a.userId],
    );
  }
  return flipped.rows.length;
}

/** Line ids already returned on earlier refunds/exchanges of a sale. */
export async function alreadyReturnedLines(client: PoolClient, saleId: number): Promise<Set<number>> {
  const r = await client.query<{ id: number }>(
    `SELECT DISTINCT unnest(line_ids) AS id
       FROM pos_refunds
      WHERE original_sale_id = $1 AND line_ids IS NOT NULL`,
    [saleId],
  );
  return new Set(r.rows.map((x) => Number(x.id)));
}
