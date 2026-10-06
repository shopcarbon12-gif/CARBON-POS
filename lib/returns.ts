import type { Pool, PoolClient } from "pg";

/**
 * Per-item, tag-verified returns shared by refunds and exchanges.
 *
 * Every RFID piece coming back is identified by the EPC scanned on the
 * way in — it must be a tag that was SOLD on that exact sale line and not
 * already returned. Pieces sold without a tag are returned by quantity.
 * Credit per piece is the line's per-unit share of its total (incl. tax),
 * capped overall at what's still refundable on the sale.
 */

export class ReturnError extends Error {}

export type ReturnItemInput = { line_id: number; epc?: string | null; quantity?: number };

export type { ReturnableLine, ReturnableSale } from "@/lib/returns-types";
import type { ReturnableSale } from "@/lib/returns-types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Load a sale at this store with what's still returnable on every line.
 * Find it by id, or by the receipt number / scanned receipt barcode
 * (12-digit sale number, or 13 digits with the EAN check digit).
 */
export async function loadReturnable(
  db: Pool | PoolClient,
  a: { lid: string; saleId?: number; number?: string; lock?: boolean },
): Promise<ReturnableSale | null> {
  const numbers: string[] = [];
  if (a.number) {
    const n = a.number.trim().toUpperCase();
    numbers.push(n);
    if (/^\d{13}$/.test(n)) numbers.push(n.slice(0, 12));
  }
  const s = await db.query(
    `SELECT s.id, s.sale_number, s.status, s.total_amount, s.tax_amount, s.completed_at,
            s.customer_id, c.first_name, c.last_name, c.email
       FROM pos_sales s
       JOIN pos_locations pl ON pl.id = s.pos_location_id
       LEFT JOIN pos_customers c ON c.id = s.customer_id
      WHERE pl.wms_location_id = $1::uuid
        AND ($2::int IS NULL OR s.id = $2)
        AND ($3::text[] IS NULL OR upper(s.sale_number) = ANY($3::text[]))
      ORDER BY s.id DESC
      LIMIT 1
      ${a.lock ? "FOR UPDATE OF s" : ""}`,
    [a.lid, a.saleId ?? null, numbers.length ? numbers : null],
  );
  const sale = s.rows[0];
  if (!sale) return null;

  // Sequential: callers may pass a single transaction client, which can't
  // run queries concurrently.
  const q = async () => [
    await db.query(
      `SELECT id, description, quantity, line_total, tax_amount, line_type,
              COALESCE(epcs, CASE WHEN epc IS NULL THEN ARRAY[]::text[] ELSE ARRAY[epc] END) AS epcs
         FROM pos_sale_lines WHERE sale_id = $1 ORDER BY id`,
      [sale.id],
    ),
    await db.query(
      `SELECT ri.sale_line_id, SUM(ri.quantity)::int AS qty,
              COALESCE(array_agg(ri.epc) FILTER (WHERE ri.epc IS NOT NULL), ARRAY[]::text[]) AS epcs
         FROM pos_refund_items ri
         JOIN pos_refunds rf ON rf.id = ri.refund_id
        WHERE rf.original_sale_id = $1
        GROUP BY ri.sale_line_id`,
      [sale.id],
    ),
    // Older whole-line returns (line_ids without per-item rows).
    await db.query(
      `SELECT DISTINCT unnest(rf.line_ids) AS id
         FROM pos_refunds rf
        WHERE rf.original_sale_id = $1 AND rf.line_ids IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM pos_refund_items ri WHERE ri.refund_id = rf.id)`,
      [sale.id],
    ),
    await db.query(`SELECT COALESCE(SUM(amount),0) AS t FROM pos_refunds WHERE original_sale_id = $1`, [sale.id]),
  ] as const;
  const [linesR, itemsR, legacyR, refundedR] = await q();
  const returned = new Map(itemsR.rows.map((r) => [Number(r.sale_line_id), r]));
  const legacy = new Set(legacyR.rows.map((r) => Number(r.id)));
  const total = Number(sale.total_amount);
  const refunded = Number(refundedR.rows[0].t);

  return {
    id: sale.id,
    sale_number: sale.sale_number,
    status: sale.status,
    total,
    tax: Number(sale.tax_amount),
    refunded,
    remaining: r2(Math.max(0, total - refunded)),
    completed_at: sale.completed_at ? new Date(sale.completed_at).toISOString() : null,
    customer:
      sale.customer_id != null
        ? {
            id: sale.customer_id,
            name: [sale.first_name, sale.last_name].filter(Boolean).join(" ") || null,
            email: sale.email ?? null,
          }
        : null,
    lines: linesR.rows.map((l) => {
      const qty = Number(l.quantity);
      const ret = returned.get(Number(l.id));
      const returnedQty = legacy.has(Number(l.id)) ? qty : Number(ret?.qty ?? 0);
      const epcs: string[] = (l.epcs ?? []).map((e: string) => e.toUpperCase());
      const returnedEpcs: string[] = legacy.has(Number(l.id))
        ? epcs
        : (ret?.epcs ?? []).map((e: string) => e.toUpperCase());
      return {
        id: Number(l.id),
        description: l.description,
        quantity: qty,
        line_total: Number(l.line_total),
        tax_amount: Number(l.tax_amount),
        line_type: l.line_type,
        epcs,
        returned_epcs: returnedEpcs,
        returned_qty: Math.min(qty, returnedQty),
        available_qty: Math.max(0, qty - returnedQty),
        unit_value: qty > 0 ? r2(Number(l.line_total) / qty) : 0,
      };
    }),
  };
}

export type ReturnEntry = {
  line_id: number;
  epc: string | null;
  quantity: number;
  amount: number;
  tax: number;
};

export type ReturnQuote = {
  saleId: number;
  saleNumber: string;
  saleTotal: number;
  saleTax: number;
  customerId: number | null;
  entries: ReturnEntry[];
  lineIds: number[];
  epcs: string[];
  /** Credit for the returned pieces, capped at what's still refundable. */
  credit: number;
  tax: number;
  fullyRefunded: boolean;
};

/**
 * Validate and price the pieces coming back. RFID lines need one scanned
 * EPC per piece, sold on that line and not already returned; untagged
 * lines take a quantity up to what's left.
 */
export async function priceReturn(
  db: Pool | PoolClient,
  a: { lid: string; saleId: number; items: ReturnItemInput[]; lock?: boolean },
): Promise<ReturnQuote> {
  const sale = await loadReturnable(db, { lid: a.lid, saleId: a.saleId, lock: a.lock });
  if (!sale) throw new ReturnError("The original sale wasn't found at this store.");
  if (sale.status !== "completed" && sale.status !== "refunded") {
    throw new ReturnError("That sale was voided — nothing to return.");
  }
  if (a.items.length === 0) throw new ReturnError("No items selected to return.");
  const byId = new Map(sale.lines.map((l) => [l.id, l]));
  const seenEpc = new Set<string>();
  const qtyPerLine = new Map<number, number>();
  const entries: ReturnEntry[] = [];

  for (const it of a.items) {
    const line = byId.get(it.line_id);
    if (!line || line.line_type === "loyalty_redemption") {
      throw new ReturnError("An item being returned isn't on that sale.");
    }
    if (line.epcs.length > 0) {
      const epc = (it.epc ?? "").trim().toUpperCase();
      if (!epc) {
        throw new ReturnError(`Scan the tag of "${line.description}" — RFID items must be scanned coming back.`);
      }
      if (!line.epcs.includes(epc)) {
        throw new ReturnError(`The scanned tag doesn't match the "${line.description}" sold on this receipt.`);
      }
      if (line.returned_epcs.includes(epc) || seenEpc.has(epc)) {
        throw new ReturnError(`That "${line.description}" was already returned.`);
      }
      seenEpc.add(epc);
      entries.push({ line_id: line.id, epc, quantity: 1, amount: 0, tax: 0 });
      qtyPerLine.set(line.id, (qtyPerLine.get(line.id) ?? 0) + 1);
    } else {
      const q = Math.max(1, Math.floor(it.quantity ?? 1));
      const used = (qtyPerLine.get(line.id) ?? 0) + q;
      if (used > line.available_qty) {
        throw new ReturnError(`Only ${line.available_qty} of "${line.description}" left to return.`);
      }
      qtyPerLine.set(line.id, used);
      entries.push({ line_id: line.id, epc: null, quantity: q, amount: 0, tax: 0 });
    }
  }
  for (const [lineId, q] of qtyPerLine) {
    const line = byId.get(lineId)!;
    if (q > line.available_qty) {
      throw new ReturnError(`Only ${line.available_qty} of "${line.description}" left to return.`);
    }
  }

  // Price each piece with cumulative rounding — piece k of n gets
  // round(total·k/n) − round(total·(k−1)/n) — so a line's pieces always
  // add up to exactly its total, however they're returned over time.
  const cursor = new Map<number, number>();
  for (const e of entries) {
    const line = byId.get(e.line_id)!;
    const before = cursor.get(line.id) ?? line.returned_qty;
    const after = before + e.quantity;
    e.amount = r2(r2((line.line_total * after) / line.quantity) - r2((line.line_total * before) / line.quantity));
    e.tax = r2(r2((line.tax_amount * after) / line.quantity) - r2((line.tax_amount * before) / line.quantity));
    cursor.set(line.id, after);
  }

  const value = r2(entries.reduce((s, e) => s + e.amount, 0));
  const credit = r2(Math.min(value, sale.remaining));
  if (credit <= 0) throw new ReturnError("Nothing is left to refund on that sale.");
  return {
    saleId: sale.id,
    saleNumber: sale.sale_number,
    saleTotal: sale.total,
    saleTax: sale.tax,
    customerId: sale.customer?.id ?? null,
    entries,
    lineIds: [...new Set(entries.map((e) => e.line_id))],
    epcs: entries.map((e) => e.epc).filter((x): x is string => !!x),
    credit,
    tax: r2(entries.reduce((s, e) => s + e.tax, 0)),
    fullyRefunded: credit >= sale.remaining - 0.005,
  };
}

/** Record the returned pieces on a refund row. */
export async function recordReturnItems(client: PoolClient, refundId: number, entries: ReturnEntry[]) {
  for (const e of entries) {
    await client.query(
      `INSERT INTO pos_refund_items (refund_id, sale_line_id, epc, quantity, amount, tax_amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [refundId, e.line_id, e.epc, e.quantity, e.amount, e.tax],
    );
  }
}

/**
 * Put exactly the scanned tags back in stock. Only tags still 'sold'
 * flip; one STATUS_CHANGE audit row per flipped EPC, mirroring capture.
 */
export async function restockEpcs(
  client: PoolClient,
  a: { epcs: string[]; tenantId: string; userId: string; reason: "pos_refund" | "pos_exchange" },
): Promise<number> {
  if (a.epcs.length === 0) return 0;
  const flipped = await client.query<{ epc: string; old_status: string }>(
    `WITH prev AS (
       SELECT epc, status AS old_status FROM items WHERE epc = ANY($1::text[])
     )
     UPDATE items i
        SET status = 'in-stock'
       FROM prev p
      WHERE i.epc = p.epc AND i.status = 'sold'
     RETURNING i.epc, p.old_status`,
    [a.epcs],
  );
  for (const r of flipped.rows) {
    await client.query(
      `INSERT INTO inventory_audit_logs
         (tenant_id, log_type, entity_type, entity_reference,
          old_value, new_value, reason, user_id, user_uuid)
       VALUES ($1::uuid, 'STATUS_CHANGE', 'EPC', $2, $3, 'in-stock', $4, NULL, $5::uuid)`,
      [a.tenantId, r.epc, r.old_status, a.reason, a.userId],
    );
  }
  return flipped.rows.length;
}
