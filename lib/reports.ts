import { getPool } from "@/lib/db";

/**
 * Back-office reports (Reports tab). Each report is defined once here and
 * feeds both the on-screen page and its CSV download, so the two can
 * never disagree.
 *
 * Every report is:
 *   - scoped to the signed-in store (pos_location_id),
 *   - bucketed by the store's local day (pos_locations.timezone), not UTC,
 *   - counts sales that were later refunded as sales on the day they
 *     happened (status 'completed' OR 'refunded'); refunds are reported
 *     separately on the day they were issued.
 */

export type ColKind = "text" | "int" | "money" | "datetime" | "date" | "pct";

export type Col = { key: string; header: string; kind?: ColKind };

export type Cell = string | number | null;

type LinkMap = Record<string, string>;

export type Row = {
  [key: string]: Cell | LinkMap | undefined;
  /** Optional per-cell links, keyed by column key. */
  _links?: LinkMap;
};

/** A row's value for a column (never the link map). */
export function cellOf(row: Row, key: string): Cell {
  const v = row[key];
  return v === undefined || (typeof v === "object" && v !== null) ? null : v;
}

export type Section = {
  title?: string;
  columns: Col[];
  rows: Row[];
  totals?: Row;
  empty?: string;
};

export type Stat = { label: string; value: number; kind: "int" | "money" };

export type ReportResult = { stats?: Stat[]; sections: Section[]; note?: string };

export type ReportCtx = {
  code: string;
  posLocationId: number;
  tz: string;
  from: string;
  to: string;
};

export type ReportDef = {
  slug: string;
  title: string;
  description: string;
  /** Default window: the current store day, or month-to-date. */
  defaultRange: "today" | "month";
  run: (ctx: ReportCtx) => Promise<ReportResult>;
};

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** SQL: a user's display name, falling back to email. */
const userName = (a: string) =>
  `COALESCE(NULLIF(TRIM(COALESCE(${a}.first_name,'') || ' ' || COALESCE(${a}.last_name,'')), ''), ${a}.email)`;

/** SQL: `col` falls on a store-local day inside [$3, $4]. tz = $2. */
const inRange = (col: string) =>
  `(${col} AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date`;

/** Sales that count as sales (refunds are tracked on their own). */
const SOLD = `s.status IN ('completed','refunded')`;

/** Product-ish lines — excludes loyalty reward lines (negative price). */
const ITEM_LINES = `sl.line_type IN ('product','misc','gift_card')`;

export const PAYMENT_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Credit / Debit Card",
  check: "Check",
  store_credit: "Store Credit",
  account: "Credit Account",
  gift_card: "Gift Card",
};

export const REFUND_LABEL: Record<string, string> = {
  original_card: "Back to card",
  cash: "Cash",
  store_credit: "Store credit",
};

const params = (c: ReportCtx) => [c.posLocationId, c.tz, c.from, c.to];

const saleLink = (c: ReportCtx, id: unknown) =>
  id ? `/sales/${c.code}/${id}` : undefined;

function sumRows(rows: Row[], keys: string[], label: Record<string, Cell>): Row {
  const t: Row = { ...label };
  for (const k of keys) t[k] = r2(rows.reduce((a, r) => a + n(r[k]), 0));
  return t;
}

/* ------------------------------------------------------------------ */
/* End of Day                                                           */
/* ------------------------------------------------------------------ */

const endOfDay: ReportDef = {
  slug: "end-of-day",
  title: "End of Day",
  description:
    "Store totals for the day: sales, payments, refunds, registers, cash drawers and sales by hour.",
  defaultRange: "today",
  async run(c) {
    const pool = getPool();
    const p = params(c);
    const [tot, voids, pay, ref, reg, sess, hours] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS tx, COALESCE(SUM(subtotal),0) AS gross,
                COALESCE(SUM(discount_amount),0) AS disc,
                COALESCE(SUM(tax_amount),0) AS tax,
                COALESCE(SUM(total_amount),0) AS total
           FROM pos_sales s
          WHERE s.pos_location_id = $1 AND ${SOLD} AND ${inRange("s.completed_at")}`,
        p,
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM pos_sales s
          WHERE s.pos_location_id = $1 AND s.status = 'voided'
            AND ${inRange("COALESCE(s.voided_at, s.created_at)")}`,
        p,
      ),
      pool.query(
        `SELECT p.method, COUNT(*) AS cnt, COALESCE(SUM(p.amount),0) AS amount
           FROM pos_payments p JOIN pos_sales s ON s.id = p.sale_id
          WHERE s.pos_location_id = $1 AND ${SOLD} AND p.status = 'completed'
            AND ${inRange("s.completed_at")}
          GROUP BY p.method`,
        p,
      ),
      pool.query(
        `SELECT rf.method, COUNT(*) AS cnt, COALESCE(SUM(rf.amount),0) AS amount
           FROM pos_refunds rf JOIN pos_sales s ON s.id = rf.original_sale_id
          WHERE s.pos_location_id = $1 AND ${inRange("rf.created_at")}
          GROUP BY rf.method`,
        p,
      ),
      pool.query(
        `SELECT r.name, COUNT(*) AS cnt, COALESCE(SUM(s.total_amount),0) AS total
           FROM pos_sales s JOIN pos_registers r ON r.id = s.register_id
          WHERE s.pos_location_id = $1 AND ${SOLD} AND ${inRange("s.completed_at")}
          GROUP BY r.name ORDER BY r.name`,
        p,
      ),
      pool.query(
        `SELECT ss.id, r.name AS register, ss.status, ss.opened_at, ss.closed_at,
                ${userName("uo")} AS opened_by, ${userName("uc")} AS closed_by,
                ss.opening_cash, ss.expected_cash, ss.closing_cash_counted, ss.cash_over_short
           FROM pos_register_sessions ss
           JOIN pos_registers r ON r.id = ss.register_id
           JOIN users uo        ON uo.id = ss.opened_by
           LEFT JOIN users uc   ON uc.id = ss.closed_by
          WHERE r.pos_location_id = $1 AND ${inRange("ss.opened_at")}
          ORDER BY ss.opened_at`,
        p,
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM s.completed_at AT TIME ZONE $2)::int AS hr,
                COUNT(*) AS cnt, COALESCE(SUM(s.total_amount),0) AS total
           FROM pos_sales s
          WHERE s.pos_location_id = $1 AND ${SOLD} AND ${inRange("s.completed_at")}
          GROUP BY hr ORDER BY hr`,
        p,
      ),
    ]);
    const t = tot.rows[0];
    const refundTotal = ref.rows.reduce((a, r) => a + n(r.amount), 0);

    const payRows: Row[] = pay.rows
      .map((r) => ({ method: PAYMENT_LABEL[r.method] ?? r.method, count: n(r.cnt), amount: n(r.amount) }))
      .sort((a, b) => b.amount - a.amount);
    const refRows: Row[] = ref.rows.map((r) => ({
      method: REFUND_LABEL[r.method] ?? r.method,
      count: n(r.cnt),
      amount: n(r.amount),
    }));
    const regRows: Row[] = reg.rows.map((r) => ({ register: r.name, count: n(r.cnt), total: n(r.total) }));
    const sessRows: Row[] = sess.rows.map((s) => ({
      register: s.register,
      opened: iso(s.opened_at),
      opened_by: s.opened_by,
      closed: s.closed_at ? iso(s.closed_at) : "Still open",
      closed_by: s.closed_by ?? "",
      opening: n(s.opening_cash),
      expected: s.expected_cash != null ? n(s.expected_cash) : null,
      counted: s.closing_cash_counted != null ? n(s.closing_cash_counted) : null,
      over_short: s.cash_over_short != null ? n(s.cash_over_short) : null,
      _links: { register: `/reports/${c.code}/registers/${s.id}` },
    }));
    const hourRows: Row[] = hours.rows.map((h) => ({
      hour: hourLabel(h.hr),
      count: n(h.cnt),
      total: n(h.total),
    }));

    return {
      stats: [
        { label: "Transactions", value: n(t.tx), kind: "int" },
        { label: "Gross sales", value: n(t.gross), kind: "money" },
        { label: "Discounts", value: n(t.disc), kind: "money" },
        { label: "Tax", value: n(t.tax), kind: "money" },
        { label: "Total sales", value: n(t.total), kind: "money" },
        { label: "Refunds", value: r2(refundTotal), kind: "money" },
        { label: "Net (sales − refunds)", value: r2(n(t.total) - refundTotal), kind: "money" },
        { label: "Voided sales", value: n(voids.rows[0]?.cnt), kind: "int" },
      ],
      sections: [
        {
          title: "Payments by method",
          columns: [
            { key: "method", header: "Method" },
            { key: "count", header: "Count", kind: "int" },
            { key: "amount", header: "Amount", kind: "money" },
          ],
          rows: payRows,
          totals: sumRows(payRows, ["count", "amount"], { method: "Total" }),
          empty: "No payments.",
        },
        {
          title: "Refunds by method",
          columns: [
            { key: "method", header: "Method" },
            { key: "count", header: "Count", kind: "int" },
            { key: "amount", header: "Amount", kind: "money" },
          ],
          rows: refRows,
          totals: sumRows(refRows, ["count", "amount"], { method: "Total" }),
          empty: "No refunds.",
        },
        {
          title: "By register",
          columns: [
            { key: "register", header: "Register" },
            { key: "count", header: "Sales", kind: "int" },
            { key: "total", header: "Total", kind: "money" },
          ],
          rows: regRows,
          totals: sumRows(regRows, ["count", "total"], { register: "Total" }),
          empty: "No sales.",
        },
        {
          title: "Cash drawers",
          columns: [
            { key: "register", header: "Register" },
            { key: "opened", header: "Opened", kind: "datetime" },
            { key: "opened_by", header: "Opened by" },
            { key: "closed", header: "Closed", kind: "datetime" },
            { key: "closed_by", header: "Closed by" },
            { key: "opening", header: "Opening", kind: "money" },
            { key: "expected", header: "Expected", kind: "money" },
            { key: "counted", header: "Counted", kind: "money" },
            { key: "over_short", header: "Over/Short", kind: "money" },
          ],
          rows: sessRows,
          empty: "No registers opened.",
        },
        {
          title: "Sales by hour",
          columns: [
            { key: "hour", header: "Hour" },
            { key: "count", header: "Sales", kind: "int" },
            { key: "total", header: "Total", kind: "money" },
          ],
          rows: hourRows,
          empty: "No sales.",
        },
      ],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Sales Tax                                                            */
/* ------------------------------------------------------------------ */

const salesTax: ReportDef = {
  slug: "sales-tax",
  title: "Sales Tax",
  description:
    "Tax collected per store day, less tax given back on refunds — the number to file.",
  defaultRange: "month",
  async run(c) {
    const pool = getPool();
    const p = params(c);
    const [sales, refunds] = await Promise.all([
      pool.query(
        `SELECT (s.completed_at AT TIME ZONE $2)::date::text AS day,
                COUNT(*) AS tx,
                COALESCE(SUM(s.subtotal),0) AS gross,
                COALESCE(SUM(s.discount_amount),0) AS disc,
                COALESCE(SUM(s.tax_amount),0) AS tax,
                COALESCE(SUM(s.total_amount),0) AS total,
                COALESCE(SUM(s.subtotal - s.discount_amount) FILTER (WHERE s.tax_amount > 0),0) AS taxable
           FROM pos_sales s
          WHERE s.pos_location_id = $1 AND ${SOLD} AND ${inRange("s.completed_at")}
          GROUP BY day`,
        p,
      ),
      // Refunds don't store tax; give back the sale's tax share pro rata.
      pool.query(
        `SELECT (rf.created_at AT TIME ZONE $2)::date::text AS day,
                COALESCE(SUM(rf.amount),0) AS amount,
                COALESCE(SUM(CASE WHEN s.total_amount > 0
                                  THEN rf.amount * s.tax_amount / s.total_amount
                                  ELSE 0 END),0) AS tax
           FROM pos_refunds rf JOIN pos_sales s ON s.id = rf.original_sale_id
          WHERE s.pos_location_id = $1 AND ${inRange("rf.created_at")}
          GROUP BY day`,
        p,
      ),
    ]);
    const days = new Map<string, Row>();
    const get = (d: string) => {
      if (!days.has(d)) {
        days.set(d, {
          day: d, tx: 0, gross: 0, disc: 0, taxable: 0, tax: 0,
          refunds: 0, tax_refunded: 0, net_tax: 0, total: 0,
        });
      }
      return days.get(d)!;
    };
    for (const s of sales.rows) {
      Object.assign(get(s.day), {
        tx: n(s.tx), gross: n(s.gross), disc: n(s.disc), taxable: n(s.taxable),
        tax: n(s.tax), total: n(s.total),
      });
    }
    for (const rf of refunds.rows) {
      Object.assign(get(rf.day), { refunds: r2(n(rf.amount)), tax_refunded: r2(n(rf.tax)) });
    }
    const rows: Row[] = [...days.values()]
      .map((r): Row => ({ ...r, net_tax: r2(n(r.tax) - n(r.tax_refunded)) }))
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const totals = sumRows(
      rows,
      ["tx", "gross", "disc", "taxable", "tax", "refunds", "tax_refunded", "net_tax", "total"],
      { day: "Total" },
    );
    return {
      stats: [
        { label: "Taxable sales", value: n(totals.taxable), kind: "money" },
        { label: "Tax collected", value: n(totals.tax), kind: "money" },
        { label: "Tax refunded", value: n(totals.tax_refunded), kind: "money" },
        { label: "Net tax due", value: n(totals.net_tax), kind: "money" },
      ],
      sections: [
        {
          columns: [
            { key: "day", header: "Day", kind: "date" },
            { key: "tx", header: "Sales", kind: "int" },
            { key: "gross", header: "Gross", kind: "money" },
            { key: "disc", header: "Discounts", kind: "money" },
            { key: "taxable", header: "Taxable sales", kind: "money" },
            { key: "tax", header: "Tax collected", kind: "money" },
            { key: "refunds", header: "Refunds", kind: "money" },
            { key: "tax_refunded", header: "Tax refunded", kind: "money" },
            { key: "net_tax", header: "Net tax", kind: "money" },
            { key: "total", header: "Total sales", kind: "money" },
          ],
          rows,
          totals,
          empty: "No sales in this range.",
        },
      ],
      note: "Tax refunded is the refunded share of each sale's tax (refund ÷ sale total × sale tax).",
    };
  },
};

/* ------------------------------------------------------------------ */
/* Sales by Product                                                     */
/* ------------------------------------------------------------------ */

const byProduct: ReportDef = {
  slug: "by-product",
  title: "Sales by Product",
  description: "Units and net sales per SKU (before tax), best sellers first.",
  defaultRange: "month",
  async run(c) {
    const r = await getPool().query(
      `SELECT cs.sku,
              COALESCE(m.description, sl.description) AS item,
              cs.color_code AS color, cs.size,
              SUM(sl.quantity)::int AS qty,
              COALESCE(SUM(sl.unit_price * sl.quantity),0) AS gross,
              COALESCE(SUM(sl.discount_amount),0) AS disc,
              COALESCE(SUM(sl.unit_price * sl.quantity - sl.discount_amount),0) AS net,
              COALESCE(SUM(sl.tax_amount),0) AS tax,
              COUNT(DISTINCT s.id) AS sales
         FROM pos_sale_lines sl
         JOIN pos_sales s         ON s.id = sl.sale_id
         LEFT JOIN custom_skus cs ON cs.id = sl.sku_id
         LEFT JOIN matrices m     ON m.id = cs.matrix_id
        WHERE s.pos_location_id = $1 AND ${SOLD} AND ${ITEM_LINES}
          AND ${inRange("s.completed_at")}
        GROUP BY cs.sku, item, cs.color_code, cs.size
        ORDER BY net DESC
        LIMIT 2000`,
      params(c),
    );
    const rows: Row[] = r.rows.map((x) => ({
      sku: x.sku ?? "—",
      item: x.item,
      color: x.color ?? "",
      size: x.size ?? "",
      sales: n(x.sales),
      qty: n(x.qty),
      gross: n(x.gross),
      disc: n(x.disc),
      net: n(x.net),
      avg: n(x.qty) ? r2(n(x.net) / n(x.qty)) : 0,
      tax: n(x.tax),
    }));
    const totals = sumRows(rows, ["sales", "qty", "gross", "disc", "net", "tax"], { sku: "Total" });
    return {
      stats: [
        { label: "Units sold", value: n(totals.qty), kind: "int" },
        { label: "Net sales", value: n(totals.net), kind: "money" },
        { label: "Discounts", value: n(totals.disc), kind: "money" },
        { label: "Products", value: rows.length, kind: "int" },
      ],
      sections: [
        {
          columns: [
            { key: "sku", header: "SKU" },
            { key: "item", header: "Item" },
            { key: "color", header: "Color" },
            { key: "size", header: "Size" },
            { key: "sales", header: "Sales", kind: "int" },
            { key: "qty", header: "Units", kind: "int" },
            { key: "gross", header: "Gross", kind: "money" },
            { key: "disc", header: "Discounts", kind: "money" },
            { key: "net", header: "Net sales", kind: "money" },
            { key: "avg", header: "Avg price", kind: "money" },
            { key: "tax", header: "Tax", kind: "money" },
          ],
          rows,
          totals: { ...totals, sales: null },
          empty: "No products sold in this range.",
        },
      ],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Sales by Employee (who rang it up)                                   */
/* ------------------------------------------------------------------ */

const byEmployee: ReportDef = {
  slug: "by-employee",
  title: "Sales by Employee",
  description: "What each cashier rang up, plus the refunds they issued.",
  defaultRange: "month",
  async run(c) {
    const pool = getPool();
    const p = params(c);
    const [sales, items, refunds] = await Promise.all([
      pool.query(
        `SELECT pe.id, ${userName("u")} AS name, COUNT(*) AS tx,
                COALESCE(SUM(s.subtotal),0) AS gross,
                COALESCE(SUM(s.discount_amount),0) AS disc,
                COALESCE(SUM(s.tax_amount),0) AS tax,
                COALESCE(SUM(s.total_amount),0) AS total
           FROM pos_sales s
           JOIN pos_employees pe ON pe.id = s.cashier_id
           JOIN users u          ON u.id = pe.user_id
          WHERE s.pos_location_id = $1 AND ${SOLD} AND ${inRange("s.completed_at")}
          GROUP BY pe.id, name`,
        p,
      ),
      pool.query(
        `SELECT s.cashier_id AS id, COALESCE(SUM(sl.quantity),0) AS units
           FROM pos_sale_lines sl JOIN pos_sales s ON s.id = sl.sale_id
          WHERE s.pos_location_id = $1 AND ${SOLD} AND ${ITEM_LINES}
            AND ${inRange("s.completed_at")}
          GROUP BY s.cashier_id`,
        p,
      ),
      pool.query(
        `SELECT pe.id, ${userName("u")} AS name, COUNT(*) AS cnt,
                COALESCE(SUM(rf.amount),0) AS amount
           FROM pos_refunds rf
           JOIN pos_sales s      ON s.id = rf.original_sale_id
           JOIN pos_employees pe ON pe.id = rf.refunded_by
           JOIN users u          ON u.id = pe.user_id
          WHERE s.pos_location_id = $1 AND ${inRange("rf.created_at")}
          GROUP BY pe.id, name`,
        p,
      ),
    ]);
    const by = new Map<number, Row>();
    const get = (id: number, name: string) => {
      if (!by.has(id)) {
        by.set(id, { name, tx: 0, units: 0, gross: 0, disc: 0, tax: 0, total: 0, avg: 0, refund_cnt: 0, refunds: 0 });
      }
      return by.get(id)!;
    };
    for (const s of sales.rows) {
      Object.assign(get(s.id, s.name), {
        tx: n(s.tx), gross: n(s.gross), disc: n(s.disc), tax: n(s.tax), total: n(s.total),
        avg: n(s.tx) ? r2(n(s.total) / n(s.tx)) : 0,
      });
    }
    for (const i of items.rows) if (by.has(i.id)) by.get(i.id)!.units = n(i.units);
    for (const rf of refunds.rows) {
      Object.assign(get(rf.id, rf.name), { refund_cnt: n(rf.cnt), refunds: n(rf.amount) });
    }
    const rows = [...by.values()].sort((a, b) => n(b.total) - n(a.total));
    const totals = sumRows(rows, ["tx", "units", "gross", "disc", "tax", "total", "refund_cnt", "refunds"], { name: "Total" });
    return {
      stats: [
        { label: "Transactions", value: n(totals.tx), kind: "int" },
        { label: "Total sales", value: n(totals.total), kind: "money" },
        { label: "Refunds issued", value: n(totals.refunds), kind: "money" },
        { label: "Employees", value: rows.length, kind: "int" },
      ],
      sections: [
        {
          columns: [
            { key: "name", header: "Employee" },
            { key: "tx", header: "Sales", kind: "int" },
            { key: "units", header: "Units", kind: "int" },
            { key: "gross", header: "Gross", kind: "money" },
            { key: "disc", header: "Discounts", kind: "money" },
            { key: "tax", header: "Tax", kind: "money" },
            { key: "total", header: "Total sales", kind: "money" },
            { key: "avg", header: "Avg sale", kind: "money" },
            { key: "refund_cnt", header: "Refunds #", kind: "int" },
            { key: "refunds", header: "Refunded", kind: "money" },
          ],
          rows,
          totals: { ...totals, avg: n(totals.tx) ? r2(n(totals.total) / n(totals.tx)) : 0 },
          empty: "No sales in this range.",
        },
      ],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Sales Credit by Employee (commission attribution)                    */
/* ------------------------------------------------------------------ */

const creditByEmployee: ReportDef = {
  slug: "credit-by-employee",
  title: "Sales Credit by Employee",
  description:
    "Who earned credit for each item (the sales associate on the line, not the cashier). Net sales are before tax — use this for commissions.",
  defaultRange: "month",
  async run(c) {
    const r = await getPool().query(
      `SELECT ${userName("u")} AS name,
              COUNT(DISTINCT s.id) AS sales,
              COALESCE(SUM(sl.quantity),0) AS units,
              COALESCE(SUM(sl.unit_price * sl.quantity),0) AS gross,
              COALESCE(SUM(sl.discount_amount),0) AS disc,
              COALESCE(SUM(sl.unit_price * sl.quantity - sl.discount_amount),0) AS net
         FROM pos_sale_lines sl
         JOIN pos_sales s      ON s.id = sl.sale_id
         JOIN pos_employees pe ON pe.id = sl.attributed_employee_id
         JOIN users u          ON u.id = pe.user_id
        WHERE s.pos_location_id = $1 AND ${SOLD} AND ${ITEM_LINES}
          AND ${inRange("s.completed_at")}
        GROUP BY name
        ORDER BY net DESC`,
      params(c),
    );
    const grand = r.rows.reduce((a, x) => a + n(x.net), 0);
    const rows: Row[] = r.rows.map((x) => ({
      name: x.name,
      sales: n(x.sales),
      units: n(x.units),
      gross: n(x.gross),
      disc: n(x.disc),
      net: n(x.net),
      share: grand ? r2((n(x.net) / grand) * 100) : 0,
    }));
    const totals = sumRows(rows, ["units", "gross", "disc", "net"], { name: "Total" });
    return {
      stats: [
        { label: "Net sales credited", value: n(totals.net), kind: "money" },
        { label: "Units", value: n(totals.units), kind: "int" },
        { label: "Employees", value: rows.length, kind: "int" },
      ],
      sections: [
        {
          columns: [
            { key: "name", header: "Employee" },
            { key: "sales", header: "Sales", kind: "int" },
            { key: "units", header: "Units", kind: "int" },
            { key: "gross", header: "Gross", kind: "money" },
            { key: "disc", header: "Discounts", kind: "money" },
            { key: "net", header: "Net sales", kind: "money" },
            { key: "share", header: "Share", kind: "pct" },
          ],
          rows,
          totals: { ...totals, share: grand ? 100 : 0 },
          empty: "No credited sales in this range.",
        },
      ],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Discounts Applied                                                    */
/* ------------------------------------------------------------------ */

const discounts: ReportDef = {
  slug: "discounts",
  title: "Discounts Applied",
  description: "Every discounted line and every loyalty reward redeemed, with who rang it.",
  defaultRange: "month",
  async run(c) {
    const r = await getPool().query(
      `SELECT s.id AS sale_id, s.completed_at, s.sale_number,
              ${userName("u")} AS cashier,
              sl.description, sl.line_type, sl.quantity, sl.unit_price,
              sl.discount_amount, sl.line_total
         FROM pos_sale_lines sl
         JOIN pos_sales s           ON s.id = sl.sale_id
         LEFT JOIN pos_employees pe ON pe.id = s.cashier_id
         LEFT JOIN users u          ON u.id = pe.user_id
        WHERE s.pos_location_id = $1 AND ${SOLD} AND ${inRange("s.completed_at")}
          AND (sl.discount_amount > 0 OR sl.line_type = 'loyalty_redemption')
        ORDER BY s.completed_at DESC
        LIMIT 2000`,
      params(c),
    );
    const rows: Row[] = r.rows.map((x) => {
      const loyalty = x.line_type === "loyalty_redemption";
      const orig = n(x.unit_price) * n(x.quantity);
      return {
        when: iso(x.completed_at),
        sale: x.sale_number,
        cashier: x.cashier ?? "",
        type: loyalty ? "Loyalty reward" : "Discount",
        item: x.description,
        qty: loyalty ? null : n(x.quantity),
        price: loyalty ? null : r2(orig),
        discount: loyalty ? r2(-orig) : n(x.discount_amount),
        pct: !loyalty && orig > 0 ? r2((n(x.discount_amount) / orig) * 100) : null,
        _links: { sale: saleLink(c, x.sale_id) ?? "" },
      };
    });
    const disc = rows.filter((x) => x.type === "Discount");
    const loyal = rows.filter((x) => x.type !== "Discount");
    const sum = (rs: Row[]) => r2(rs.reduce((a, x) => a + n(x.discount), 0));
    return {
      stats: [
        { label: "Discounted lines", value: disc.length, kind: "int" },
        { label: "Discounts given", value: sum(disc), kind: "money" },
        { label: "Loyalty rewards", value: loyal.length, kind: "int" },
        { label: "Loyalty value", value: sum(loyal), kind: "money" },
      ],
      sections: [
        {
          columns: [
            { key: "when", header: "When", kind: "datetime" },
            { key: "sale", header: "Receipt #" },
            { key: "cashier", header: "Cashier" },
            { key: "type", header: "Type" },
            { key: "item", header: "Item" },
            { key: "qty", header: "Qty", kind: "int" },
            { key: "price", header: "Price", kind: "money" },
            { key: "discount", header: "Discount", kind: "money" },
            { key: "pct", header: "% off", kind: "pct" },
          ],
          rows,
          totals: { when: "Total", discount: r2(sum(rows)) },
          empty: "No discounts in this range.",
        },
      ],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Cash Drawer Log                                                      */
/* ------------------------------------------------------------------ */

const cashDrawer: ReportDef = {
  slug: "cash-drawer",
  title: "Cash Drawer Log",
  description:
    "Every register session: opening cash, cash in and out, expected vs counted, over/short.",
  defaultRange: "month",
  async run(c) {
    const r = await getPool().query(
      `SELECT ss.id, r.name AS register, ss.status, ss.opened_at, ss.closed_at,
              ${userName("uo")} AS opened_by, ${userName("uc")} AS closed_by,
              ss.opening_cash, ss.expected_cash, ss.closing_cash_counted, ss.cash_over_short,
              (SELECT COALESCE(SUM(p.amount),0)
                 FROM pos_payments p JOIN pos_sales x ON x.id = p.sale_id
                WHERE x.register_id = ss.register_id
                  AND x.created_at >= ss.opened_at
                  AND x.created_at < COALESCE(ss.closed_at, now())
                  AND p.method = 'cash' AND p.status = 'completed') AS cash_sales,
              (SELECT COALESCE(SUM(amount),0) FROM pos_cash_movements
                WHERE register_session_id = ss.id AND type = 'add') AS adds,
              (SELECT COALESCE(SUM(amount),0) FROM pos_cash_movements
                WHERE register_session_id = ss.id AND type = 'drop') AS drops,
              (SELECT COALESCE(SUM(amount),0) FROM pos_cash_movements
                WHERE register_session_id = ss.id AND type = 'payout') AS payouts,
              (SELECT COALESCE(SUM(amount),0) FROM pos_refunds
                WHERE register_session_id = ss.id AND method = 'cash') AS cash_refunds
         FROM pos_register_sessions ss
         JOIN pos_registers r ON r.id = ss.register_id
         JOIN users uo        ON uo.id = ss.opened_by
         LEFT JOIN users uc   ON uc.id = ss.closed_by
        WHERE r.pos_location_id = $1 AND ${inRange("ss.opened_at")}
        ORDER BY ss.opened_at DESC`,
      params(c),
    );
    const rows: Row[] = r.rows.map((s) => {
      const computed = r2(
        n(s.opening_cash) + n(s.cash_sales) + n(s.adds) - n(s.drops) - n(s.payouts) - n(s.cash_refunds),
      );
      return {
        register: s.register,
        opened: iso(s.opened_at),
        opened_by: s.opened_by,
        closed: s.closed_at ? iso(s.closed_at) : "Still open",
        closed_by: s.closed_by ?? "",
        opening: n(s.opening_cash),
        cash_sales: n(s.cash_sales),
        adds: n(s.adds),
        drops: n(s.drops),
        payouts: n(s.payouts),
        cash_refunds: n(s.cash_refunds),
        expected: s.expected_cash != null ? n(s.expected_cash) : computed,
        counted: s.closing_cash_counted != null ? n(s.closing_cash_counted) : null,
        over_short: s.cash_over_short != null ? n(s.cash_over_short) : null,
        _links: { register: `/reports/${c.code}/registers/${s.id}` },
      };
    });
    const closed = rows.filter((x) => x.over_short != null);
    const totals = sumRows(
      rows,
      ["cash_sales", "adds", "drops", "payouts", "cash_refunds", "over_short"],
      { register: "Total" },
    );
    return {
      stats: [
        { label: "Sessions", value: rows.length, kind: "int" },
        { label: "Cash sales", value: n(totals.cash_sales), kind: "money" },
        { label: "Drops", value: n(totals.drops), kind: "money" },
        { label: "Net over/short", value: r2(closed.reduce((a, x) => a + n(x.over_short), 0)), kind: "money" },
      ],
      sections: [
        {
          columns: [
            { key: "register", header: "Register" },
            { key: "opened", header: "Opened", kind: "datetime" },
            { key: "opened_by", header: "Opened by" },
            { key: "closed", header: "Closed", kind: "datetime" },
            { key: "closed_by", header: "Closed by" },
            { key: "opening", header: "Opening", kind: "money" },
            { key: "cash_sales", header: "Cash sales", kind: "money" },
            { key: "adds", header: "Adds", kind: "money" },
            { key: "drops", header: "Drops", kind: "money" },
            { key: "payouts", header: "Payouts", kind: "money" },
            { key: "cash_refunds", header: "Cash refunds", kind: "money" },
            { key: "expected", header: "Expected", kind: "money" },
            { key: "counted", header: "Counted", kind: "money" },
            { key: "over_short", header: "Over/Short", kind: "money" },
          ],
          rows,
          totals,
          empty: "No register sessions in this range.",
        },
      ],
      note: "Click a register to open that session's Open and End of Day reports.",
    };
  },
};

/* ------------------------------------------------------------------ */
/* Refunds & Voids                                                      */
/* ------------------------------------------------------------------ */

const refunds: ReportDef = {
  slug: "refunds",
  title: "Refunds & Voids",
  description: "Every refund and voided sale, with reason and who did it.",
  defaultRange: "month",
  async run(c) {
    const pool = getPool();
    const p = params(c);
    const [rf, vd] = await Promise.all([
      pool.query(
        `SELECT rf.created_at AS at, s.id AS sale_id, s.sale_number, rf.amount,
                rf.method, rf.reason, ${userName("u")} AS by_name
           FROM pos_refunds rf
           JOIN pos_sales s           ON s.id = rf.original_sale_id
           LEFT JOIN pos_employees pe ON pe.id = rf.refunded_by
           LEFT JOIN users u          ON u.id = pe.user_id
          WHERE s.pos_location_id = $1 AND ${inRange("rf.created_at")}`,
        p,
      ),
      pool.query(
        `SELECT COALESCE(s.voided_at, s.created_at) AS at, s.id AS sale_id,
                s.sale_number, s.total_amount AS amount, s.void_reason AS reason,
                ${userName("u")} AS by_name
           FROM pos_sales s
           LEFT JOIN pos_employees pe ON pe.id = s.voided_by
           LEFT JOIN users u          ON u.id = pe.user_id
          WHERE s.pos_location_id = $1 AND s.status = 'voided'
            AND ${inRange("COALESCE(s.voided_at, s.created_at)")}`,
        p,
      ),
    ]);
    const rows: Row[] = [
      ...rf.rows.map((x) => ({
        when: iso(x.at),
        type: "Refund",
        sale: x.sale_number,
        method: REFUND_LABEL[x.method] ?? x.method,
        reason: x.reason ?? "",
        by: x.by_name ?? "",
        amount: n(x.amount),
        _links: { sale: saleLink(c, x.sale_id) ?? "" },
      })),
      ...vd.rows.map((x) => ({
        when: iso(x.at),
        type: "Void",
        sale: x.sale_number,
        method: "—",
        reason: x.reason ?? "",
        by: x.by_name ?? "",
        amount: n(x.amount),
        _links: { sale: saleLink(c, x.sale_id) ?? "" },
      })),
    ].sort((a, b) => String(b.when).localeCompare(String(a.when)));
    const refundRows = rows.filter((x) => x.type === "Refund");
    const voidRows = rows.filter((x) => x.type === "Void");
    const sum = (rs: Row[]) => r2(rs.reduce((a, x) => a + n(x.amount), 0));
    return {
      stats: [
        { label: "Refunds", value: refundRows.length, kind: "int" },
        { label: "Refunded", value: sum(refundRows), kind: "money" },
        { label: "Voided sales", value: voidRows.length, kind: "int" },
        { label: "Voided value", value: sum(voidRows), kind: "money" },
      ],
      sections: [
        {
          columns: [
            { key: "when", header: "When", kind: "datetime" },
            { key: "type", header: "Type" },
            { key: "sale", header: "Receipt #" },
            { key: "method", header: "Refunded to" },
            { key: "reason", header: "Reason" },
            { key: "by", header: "By" },
            { key: "amount", header: "Amount", kind: "money" },
          ],
          rows,
          empty: "No refunds or voids in this range.",
        },
      ],
    };
  },
};

/* ------------------------------------------------------------------ */

export const REPORTS: Record<string, ReportDef> = Object.fromEntries(
  [endOfDay, salesTax, byProduct, byEmployee, creditByEmployee, discounts, cashDrawer, refunds].map(
    (d) => [d.slug, d],
  ),
);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in the store's time zone, YYYY-MM-DD. */
export function storeToday(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Resolve the store + date window for a report request. Returns null
 * when the cashier's location has no POS setup.
 */
export async function reportContext(
  def: ReportDef,
  code: string,
  lid: string,
  sp: { from?: string | null; to?: string | null },
): Promise<ReportCtx | null> {
  const r = await getPool().query(
    `SELECT id, COALESCE(timezone, 'America/New_York') AS tz
       FROM pos_locations WHERE wms_location_id = $1::uuid LIMIT 1`,
    [lid],
  );
  const loc = r.rows[0];
  if (!loc) return null;
  const today = storeToday(loc.tz);
  const fallbackFrom = def.defaultRange === "today" ? today : `${today.slice(0, 8)}01`;
  let from = sp.from && DATE_RE.test(sp.from) ? sp.from : fallbackFrom;
  let to = sp.to && DATE_RE.test(sp.to) ? sp.to : today;
  if (from > to) [from, to] = [to, from];
  return { code, posLocationId: loc.id, tz: loc.tz, from, to };
}

/* ------------------------------------------------------------------ */
/* formatting                                                           */
/* ------------------------------------------------------------------ */

function iso(v: unknown): string {
  return new Date(v as string).toISOString();
}

function hourLabel(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
}

/** Display text for a cell (screen). */
export function formatCell(v: Cell, kind: ColKind | undefined, tz: string): string {
  if (v === null || v === undefined || v === "") return kind && kind !== "text" ? "—" : "";
  switch (kind) {
    case "money":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n(v));
    case "int":
      return new Intl.NumberFormat("en-US").format(n(v));
    case "pct":
      return `${n(v).toFixed(1)}%`;
    case "datetime":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)
        ? new Date(v).toLocaleString("en-US", {
            timeZone: tz,
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : String(v);
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v))
        ? new Date(`${v}T12:00:00Z`).toLocaleDateString("en-US", {
            timeZone: "UTC",
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : String(v);
    default:
      return String(v);
  }
}

/** Raw value for CSV: plain numbers, store-local timestamps. */
export function csvCell(v: Cell, kind: ColKind | undefined, tz: string): string | number | null {
  if (v === null || v === undefined) return null;
  if (kind === "money") return typeof v === "number" ? v.toFixed(2) : v;
  if (kind === "datetime" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
  }
  return v;
}
