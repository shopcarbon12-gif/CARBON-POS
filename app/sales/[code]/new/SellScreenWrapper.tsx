"use client";

import { useParams } from "next/navigation";
import { SellScreen } from "@/components/pos/SellScreen";

/**
 * Sign-out lives in the AdminShell sidebar now, so the SellScreen no
 * longer needs an onSignOut prop. The wrapper just threads `code` from
 * the URL into the cart logic.
 */
export function SellScreenWrapper({
  taxRate,
}: {
  taxRate: number;
}) {
  const { code } = useParams<{ code: string }>();
  return (
    <SellScreen
      taxRate={taxRate}
      code={String(code ?? "")}
    />
  );
}
