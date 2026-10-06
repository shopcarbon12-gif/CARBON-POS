import { redirect } from "next/navigation";

/**
 * Refunds happen on the sell screen: scan the receipt, take the pieces
 * back (each RFID piece verified by scanning its tag) and press Refund.
 * Refund receipts stay at /sales/{code}/refund/receipt.
 */
export default async function RefundPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/sales/${code}/new?returns=refund`);
}
