/** Client-safe shapes for returns (lib/returns.ts is server-side). */

export type ReturnableLine = {
  id: number;
  description: string;
  quantity: number;
  line_total: number;
  tax_amount: number;
  line_type: string;
  /** Tags sold on this line. Empty = sold without RFID. */
  epcs: string[];
  returned_epcs: string[];
  returned_qty: number;
  available_qty: number;
  /** Per-unit credit (line total ÷ quantity, rounded). */
  unit_value: number;
};

export type ReturnableSale = {
  id: number;
  sale_number: string;
  status: string;
  total: number;
  tax: number;
  refunded: number;
  remaining: number;
  completed_at: string | null;
  customer: { id: number; name: string | null; email: string | null } | null;
  lines: ReturnableLine[];
};
