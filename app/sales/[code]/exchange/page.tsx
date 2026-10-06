import { redirect } from "next/navigation";

/**
 * Exchanges happen on the sell screen: scan the receipt, take the pieces
 * back (each RFID piece verified by scanning its tag), scan the new
 * items — the cart nets the difference.
 */
export default async function ExchangePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/sales/${code}/new?returns=exchange`);
}
