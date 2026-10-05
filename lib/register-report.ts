import { getPool } from "@/lib/db";

/**
 * Data behind the Register Open report and the End-of-Day (Z) report.
 * Everything is rebuilt from the database so the same report can be
 * printed at open/close time and re-opened from the Reports tab later.
 *
 * A session's sales are tied to it by register + time window
 * (created_at between opened_at and closed_at) — pos_sales has no
 * session id. This is the same rule the close route uses for the
 * expected-cash math, so the report and the drawer reconcile.
 */

export * from "@/lib/register-report-types";
import type { ActivityRow, RegisterReport } from "@/lib/register-report-types";

const PAYMENT_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Credit / Debit Card",
  check: "Check",
  store_credit: "Store Credit",
  account: "Credit Account",
  gift_card: "Gift Card",
  exchange_credit: "Exchange credit",
};

const REFUND_LABEL: Record<string, string> = {
  original_card: "To Card",
  cash: "Cash",
  store_credit: "Store Credit",
  exchange: "Exchange",
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/** SQL for a user's display name, falling back to their email. */
const userName = (alias: string) =>
  `COALESCE(NULLIF(TRIM(COALESCE(${alias}.first_name,'') || ' ' || COALESCE(${alias}.last_name,'')), ''), ${alias}.email)`;

/**
 * Load the full report for one register session. Returns null when the
 * session doesn't exist or belongs to a different store than `lid`.
 */
export async function loadRegisterReport(
  sessionId: number,
  lid: string,
): Promise<RegisterReport | null> {
  const pool = getPool();
  const sr = await pool.query(
    `SELECT s.id, s.status, s.register_id, s.opened_at, s.closed_at,
            s.opening_cash, s.opening_denoms, s.closing_denoms,
            s.closing_cash_counted, s.expected_cash, s.cash_over_short,
            s.closing_counts, s.close_note,
            ${userName("uo")} AS opened_by_name,
            ${userName("uc")} AS closed_by_name,
            r.name AS register_name, r.pos_location_id,
            l.name AS location_name,
            pl.address_line1, pl.address_line2, pl.city, pl.state, pl.zip,
            pl.phone, pl.timezone, pl.printer_host
       FROM pos_register_sessions s
       JOIN pos_registers   r  ON r.id = s.register_id
       JOIN pos_locations   pl ON pl.id = r.pos_location_id
       JOIN locations       l  ON l.id = pl.wms_location_id
       JOIN users           uo ON uo.id = s.opened_by
       LEFT JOIN users      uc ON uc.id = s.closed_by
      WHERE s.id = $1 AND pl.wms_location_id = $2::uuid
      LIMIT 1`,
    [sessionId, lid],
  );
  const s = sr.rows[0];
  if (!s) return null;

  // Session window: [opened_at, closed_at) — open sessions run to now.
  const win = [s.register_id, s.opened_at, s.closed_at];
  const saleWindow = `s.register_id = $1
        AND s.created_at >= $2::timestamptz
        AND s.created_at < COALESCE($3::timestamptz, now())`;

  const [salesR, itemsR, payR, refundR, cashRefundR, moveR, empR, saleListR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE s.status IN ('completed','refunded'))     AS sales_count,
              COUNT(*) FILTER (WHERE s.status = 'voided')                      AS voided_count,
              COALESCE(SUM(s.subtotal)        FILTER (WHERE s.status IN ('completed','refunded')), 0) AS gross,
              COALESCE(SUM(s.discount_amount) FILTER (WHERE s.status IN ('completed','refunded')), 0) AS discounts,
              COALESCE(SUM(s.tax_amount)      FILTER (WHERE s.status IN ('completed','refunded')), 0) AS tax,
              COALESCE(SUM(s.total_amount)    FILTER (WHERE s.status IN ('completed','refunded')), 0) AS total,
              (ARRAY_AGG(s.sale_number ORDER BY s.created_at ASC)
                 FILTER (WHERE s.status IN ('completed','refunded')))[1]  AS first_sale,
              (ARRAY_AGG(s.sale_number ORDER BY s.created_at DESC)
                 FILTER (WHERE s.status IN ('completed','refunded')))[1]  AS last_sale
         FROM pos_sales s
        WHERE ${saleWindow}`,
      win,
    ),
    pool.query(
      `SELECT COALESCE(SUM(sl.quantity), 0) AS items
         FROM pos_sale_lines sl
         JOIN pos_sales s ON s.id = sl.sale_id
        WHERE ${saleWindow}
          AND s.status IN ('completed','refunded')
          AND sl.line_type IN ('product','misc','gift_card')`,
      win,
    ),
    pool.query(
      `SELECT p.method, COUNT(*) AS cnt, COALESCE(SUM(p.amount), 0) AS amount
         FROM pos_payments p
         JOIN pos_sales s ON s.id = p.sale_id
        WHERE ${saleWindow}
          AND p.status = 'completed'
        GROUP BY p.method`,
      win,
    ),
    // Refunds paid out of this session's drawer. Refunds from before
    // migration 016 have no session link — fall back to the ones issued
    // at this store during the shift.
    pool.query(
      `SELECT rf.method, rf.amount, rf.reason, rf.created_at,
              s.id AS sale_id, s.sale_number,
              ${userName("u")} AS by_name
         FROM pos_refunds rf
         JOIN pos_sales s          ON s.id = rf.original_sale_id
         LEFT JOIN pos_employees pe ON pe.id = rf.refunded_by
         LEFT JOIN users u          ON u.id = pe.user_id
        WHERE rf.register_session_id = $4
           OR (rf.register_session_id IS NULL
               AND s.pos_location_id = $1
               AND rf.created_at >= $2::timestamptz
               AND rf.created_at < COALESCE($3::timestamptz, now()))
        ORDER BY rf.created_at`,
      [s.pos_location_id, s.opened_at, s.closed_at, s.id],
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS amount
         FROM pos_refunds
        WHERE register_session_id = $1 AND method = 'cash'`,
      [s.id],
    ),
    pool.query(
      `SELECT m.type, m.amount, m.reason, m.created_at,
              ${userName("u")} AS by_name
         FROM pos_cash_movements m
         LEFT JOIN users u ON u.id = m.done_by
        WHERE m.register_session_id = $1
        ORDER BY m.created_at`,
      [s.id],
    ),
    pool.query(
      `SELECT ${userName("u")} AS name,
              COUNT(*) AS cnt,
              COALESCE(SUM(s.total_amount), 0) AS total
         FROM pos_sales s
         JOIN pos_employees pe ON pe.id = s.cashier_id
         JOIN users u          ON u.id = pe.user_id
        WHERE ${saleWindow}
          AND s.status IN ('completed','refunded')
        GROUP BY 1
        ORDER BY 3 DESC`,
      win,
    ),
    pool.query(
      `SELECT s.id, s.sale_number, s.status, s.created_at, s.total_amount,
              ${userName("u")} AS by_name,
              (SELECT string_agg(p.method, ',' ORDER BY p.id)
                 FROM pos_payments p
                WHERE p.sale_id = s.id AND p.status = 'completed') AS methods
         FROM pos_sales s
         LEFT JOIN pos_employees pe ON pe.id = s.cashier_id
         LEFT JOIN users u          ON u.id = pe.user_id
        WHERE ${saleWindow}
          AND s.status IN ('completed','refunded','voided')
        ORDER BY s.created_at`,
      win,
    ),
  ]);

  const sales = salesR.rows[0];
  const payBy = new Map<string, { cnt: number; amount: number }>();
  for (const r of payR.rows) payBy.set(r.method, { cnt: n(r.cnt), amount: n(r.amount) });
  const order = ["cash", "card", "check", "store_credit", "account", "gift_card"];
  const methods = [
    ...order.filter((m) => payBy.has(m)),
    ...[...payBy.keys()].filter((m) => !order.includes(m)),
  ];

  const movements = moveR.rows.map((m) => ({
    type: m.type as string,
    amount: n(m.amount),
    reason: (m.reason as string | null) ?? null,
    at: new Date(m.created_at).toISOString(),
    by: (m.by_name as string | null) ?? "",
  }));
  const sumMove = (t: string) =>
    movements.filter((m) => m.type === t).reduce((a, m) => a + m.amount, 0);

  const opening = n(s.opening_cash);
  const cashSales = payBy.get("cash")?.amount ?? 0;
  const adds = sumMove("add");
  const drops = sumMove("drop");
  const payouts = sumMove("payout");
  // Only refunds tied to this session came out of this drawer.
  const cashRefunds = n(cashRefundR.rows[0]?.amount);
  const refundBy = new Map<string, { count: number; amount: number }>();
  for (const r of refundR.rows) {
    const cur = refundBy.get(r.method) ?? { count: 0, amount: 0 };
    refundBy.set(r.method, { count: cur.count + 1, amount: cur.amount + n(r.amount) });
  }
  const refundRows = [...refundBy.entries()].map(([method, v]) => ({
    method,
    label: REFUND_LABEL[method] ?? method,
    count: v.count,
    amount: Math.round(v.amount * 100) / 100,
  }));

  const activity: ActivityRow[] = [
    ...saleListR.rows.map((r) => ({
      at: new Date(r.created_at).toISOString(),
      type: (r.status === "voided" ? "void" : "sale") as ActivityRow["type"],
      ref: r.sale_number as string,
      sale_id: r.id as number,
      detail: ((r.methods as string | null) ?? "")
        .split(",")
        .filter(Boolean)
        .map((m) => PAYMENT_LABEL[m] ?? m)
        .join(" + "),
      by: (r.by_name as string | null) ?? "",
      amount: r.status === "voided" ? 0 : n(r.total_amount),
    })),
    ...refundR.rows.map((r) => ({
      at: new Date(r.created_at).toISOString(),
      type: "refund" as const,
      ref: r.sale_number as string,
      sale_id: r.sale_id as number,
      detail: [REFUND_LABEL[r.method] ?? r.method, r.reason].filter(Boolean).join(" · "),
      by: (r.by_name as string | null) ?? "",
      amount: -n(r.amount),
    })),
    ...movements.map((m) => ({
      at: m.at,
      type: m.type as ActivityRow["type"],
      ref: null,
      sale_id: null,
      detail: m.reason ?? "",
      by: m.by,
      amount: m.type === "add" ? m.amount : -m.amount,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return {
    session: {
      id: s.id,
      status: s.status,
      register_name: s.register_name,
      location_name: s.location_name,
      address_line1: s.address_line1,
      address_line2: s.address_line2,
      city: s.city,
      state: s.state,
      zip: s.zip,
      phone: s.phone,
      timezone: s.timezone || "America/New_York",
      opened_at: new Date(s.opened_at).toISOString(),
      closed_at: s.closed_at ? new Date(s.closed_at).toISOString() : null,
      opened_by_name: s.opened_by_name,
      closed_by_name: s.closed_by_name ?? null,
      opening_cash: opening,
      opening_denoms: s.opening_denoms ?? null,
      closing_denoms: s.closing_denoms ?? null,
      closing_cash_counted:
        s.closing_cash_counted != null ? n(s.closing_cash_counted) : null,
      expected_cash: s.expected_cash != null ? n(s.expected_cash) : null,
      cash_over_short: s.cash_over_short != null ? n(s.cash_over_short) : null,
      closing_counts: s.closing_counts ?? null,
      close_note: s.close_note ?? null,
    },
    printer_host: s.printer_host ?? null,
    eod: {
      sales_count: n(sales.sales_count),
      voided_count: n(sales.voided_count),
      items_sold: n(itemsR.rows[0]?.items),
      first_sale_number: sales.first_sale ?? null,
      last_sale_number: sales.last_sale ?? null,
      gross: n(sales.gross),
      discounts: n(sales.discounts),
      tax: n(sales.tax),
      total: n(sales.total),
      payments: methods.map((m) => ({
        method: m,
        label: PAYMENT_LABEL[m] ?? m,
        count: payBy.get(m)!.cnt,
        amount: payBy.get(m)!.amount,
      })),
      refunds: {
        count: refundRows.reduce((a, r) => a + r.count, 0),
        total: refundRows.reduce((a, r) => a + r.amount, 0),
        by_method: refundRows.map(({ method, label, amount }) => ({
          method,
          label,
          amount,
        })),
      },
      cash: {
        opening,
        cash_sales: cashSales,
        adds,
        drops,
        payouts,
        // Same formula as /api/pos/sessions/:id/close.
        expected:
          Math.round((opening + cashSales + adds - drops - payouts - cashRefunds) * 100) / 100,
        cash_refunds: cashRefunds,
      },
      movements,
      by_employee: empR.rows.map((r) => ({
        name: r.name,
        count: n(r.cnt),
        total: n(r.total),
      })),
      activity,
    },
  };
}
