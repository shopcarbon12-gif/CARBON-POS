/**
 * POS role permission keys (mirror of WMS lib/settings/pos-permission-
 * catalog.ts). Client-safe.
 */
export type PermMode = "view" | "hide" | "approval";

export const PERM_LABEL = {
  "pos_sales.new_sale": "ring up sales",
  "pos_sales.exchange": "do exchanges",
  "pos_sales.refund": "refund",
  "pos_sales.park_sale": "hold / park sales",
  "pos_sales.sales_history": "see sales history",
  "pos_sales.discount_at_checkout": "apply discounts",
  "pos_sales.loyalty_redeem": "redeem loyalty points",
  "pos_register.open_register": "open the register",
  "pos_register.close_register": "close the register",
  "pos_register.cash_drop": "do cash drops / payouts",
  "pos_register.add_amount": "add cash to the drawer",
  "pos_register.no_sale_open_drawer": "open the cash drawer without a sale",
  "pos_customers.store_credit": "adjust store credit",
  "pos_reports.end_of_day": "see the End of Day report",
  "pos_reports.sales_tax": "see the Sales Tax report",
  "pos_reports.by_product": "see Sales by Product",
  "pos_reports.by_employee": "see Sales by Employee",
  "pos_reports.discounts": "see Discounts Applied",
  "pos_reports.refunds": "see Refunds & Voids",
  "pos_reports.cash_drawer": "see the Cash Drawer Log",
  "pos_employees.view": "see employees",
  "pos_employees.view_timecards": "see timecards",
  "pos_settings.locations": "change locations",
  "pos_settings.registers": "change registers",
  "pos_settings.discounts": "change discount rules",
  "pos_settings.readers": "change card readers",
} as const;

export type PermKey = keyof typeof PERM_LABEL;

export type PermMap = Partial<Record<PermKey, PermMode>>;

/** Report slug (lib/reports) → permission key. */
export const REPORT_PERMISSION: Record<string, PermKey> = {
  "end-of-day": "pos_reports.end_of_day",
  "sales-tax": "pos_reports.sales_tax",
  "by-product": "pos_reports.by_product",
  "by-employee": "pos_reports.by_employee",
  "credit-by-employee": "pos_reports.by_employee",
  discounts: "pos_reports.discounts",
  refunds: "pos_reports.refunds",
  "cash-drawer": "pos_reports.cash_drawer",
  hours: "pos_employees.view_timecards",
};
