/**
 * TypeScript types mirroring the pos_* and shared WMS tables.
 * Field names match SQL column names (snake_case). Use these as
 * row shapes for pool.query<Row>() calls.
 */

// --- WMS-owned tables (POS reads, never writes) ---------------------------

export type WmsLocation = {
  id: number;
  name: string;
  site_code: string | null;
};

export type CustomSku = {
  id: number;
  sku: string | null;
  upc: string | null;
  item_name: string;
  color: string | null;
  size: string | null;
  retail_price: string | null; // NUMERIC comes back as string from pg
  bin: string | null;
  matrix_id: number | null;
};

export type Matrix = {
  id: number;
  description: string | null;
};

export type Epc = {
  epc: string;
  sku_id: number | null;
  status: string;
  location_id: number | null;
  bin: string | null;
};

export type WmsUser = {
  id: number;
  email: string;
  // Other columns vary by WMS deployment; reference what you need.
};

// --- POS-owned tables -----------------------------------------------------

export type PosLocation = {
  id: number;
  wms_location_id: number;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  tax_rate: string;
  receipt_header: string | null;
  receipt_footer: string | null;
  return_policy: string | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
};

export type PosRegister = {
  id: number;
  pos_location_id: number;
  name: string;
  stripe_reader_id: string | null;
  stripe_reader_label: string | null;
  is_active: boolean;
  created_at: string;
};

export type PosRegisterSession = {
  id: number;
  register_id: number;
  opened_by: number;
  opened_at: string;
  opening_cash: string;
  closed_by: number | null;
  closed_at: string | null;
  closing_cash_counted: string | null;
  expected_cash: string | null;
  cash_over_short: string | null;
  status: "open" | "closed";
};

export type PosCashMovement = {
  id: number;
  register_session_id: number;
  type: "drop" | "payout";
  amount: string;
  reason: string | null;
  done_by: number;
  created_at: string;
};

export type PosCustomer = {
  id: number;
  pos_location_id: number | null;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  customer_type: "regular" | "vip" | "staff" | "wholesale";
  store_credit_balance: string;
  notes: string | null;
  created_at: string;
};

export type PosEmployee = {
  id: number;
  user_id: number;
  pin_hash: string;
  role: "cashier" | "supervisor" | "manager" | "admin";
  is_active: boolean;
  created_at: string;
};

export type PosEmployeeClock = {
  id: number;
  employee_id: number;
  clock_in: string;
  clock_out: string | null;
  register_id: number | null;
};

export type PosSale = {
  id: number;
  sale_number: string;
  register_id: number;
  pos_location_id: number;
  cashier_id: number;
  customer_id: number | null;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  status: "open" | "completed" | "voided" | "refunded";
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  voided_at: string | null;
  voided_by: number | null;
  void_reason: string | null;
};

export type PosSaleLine = {
  id: number;
  sale_id: number;
  sku_id: number | null;
  epc: string | null;
  description: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  tax_rate: string;
  tax_amount: string;
  line_total: string;
  line_type: "product" | "misc" | "gift_card";
};

export type PosPayment = {
  id: number;
  sale_id: number;
  method: "card" | "cash" | "check" | "store_credit";
  amount: string;
  stripe_payment_intent_id: string | null;
  stripe_reader_id: string | null;
  cash_given: string | null;
  change_given: string | null;
  check_number: string | null;
  status: "pending" | "completed" | "failed" | "refunded";
  processed_at: string | null;
};

export type PosRefund = {
  id: number;
  original_sale_id: number;
  amount: string;
  reason: string | null;
  method: "original_card" | "cash" | "store_credit";
  stripe_refund_id: string | null;
  refunded_by: number;
  created_at: string;
};

export type PosDiscountRule = {
  id: number;
  pos_location_id: number | null;
  name: string;
  type: "percent" | "fixed";
  value: string;
  applies_to: "all" | "customer_type" | "sku_id";
  applies_to_value: string | null;
  start_date: string | null;
  end_date: string | null;
  requires_manager_pin: boolean;
  is_active: boolean;
  created_at: string;
};

// --- Cart shapes (in-memory on the sell screen) ---------------------------

export type CartLine = {
  /** Stable per-row id within the cart; not the DB id. */
  cart_id: string;
  sku_id: number | null;
  epc: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate: number;
  line_type: "product" | "misc" | "gift_card";
};

export type CartTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};
