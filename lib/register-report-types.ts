/**
 * Shapes shared by the server loader (lib/register-report.ts) and the
 * client report view. Kept free of server imports so client components
 * can use it.
 */

export const DENOM_VALUES = [100, 50, 20, 10, 5, 1] as const;

export type Denoms = Record<string, number>;

export type CountRow = {
  key: string;
  label: string;
  calculated: number;
  counted: number;
  over_short: number;
};

export type RegisterReport = {
  session: {
    id: number;
    status: "open" | "closed";
    register_name: string;
    location_name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    timezone: string;
    opened_at: string;
    closed_at: string | null;
    opened_by_name: string;
    closed_by_name: string | null;
    opening_cash: number;
    opening_denoms: Denoms | null;
    closing_denoms: Denoms | null;
    closing_cash_counted: number | null;
    expected_cash: number | null;
    cash_over_short: number | null;
    closing_counts: CountRow[] | null;
    close_note: string | null;
  };
  printer_host: string | null;
  /** Shift activity. Present for closed sessions (and live for open ones). */
  eod: {
    sales_count: number;
    voided_count: number;
    items_sold: number;
    first_sale_number: string | null;
    last_sale_number: string | null;
    gross: number;
    discounts: number;
    tax: number;
    total: number;
    payments: Array<{ method: string; label: string; count: number; amount: number }>;
    refunds: {
      count: number;
      total: number;
      by_method: Array<{ method: string; label: string; amount: number }>;
    };
    cash: {
      opening: number;
      cash_sales: number;
      adds: number;
      drops: number;
      payouts: number;
      expected: number;
      cash_refunds: number;
    };
    movements: Array<{
      type: string;
      amount: number;
      reason: string | null;
      at: string;
      by: string;
    }>;
    by_employee: Array<{ name: string; count: number; total: number }>;
  };
};
