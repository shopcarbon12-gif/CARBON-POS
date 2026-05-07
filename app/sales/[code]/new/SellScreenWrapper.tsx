"use client";

import { signOut } from "next-auth/react";
import { useParams } from "next/navigation";
import { SellScreen } from "@/components/pos/SellScreen";

export function SellScreenWrapper({
  taxRate,
  registerName,
}: {
  taxRate: number;
  registerName: string;
}) {
  const { code } = useParams<{ code: string }>();
  return (
    <SellScreen
      taxRate={taxRate}
      registerName={registerName}
      code={String(code ?? "")}
      onSignOut={() => signOut({ callbackUrl: "/sign-in" })}
    />
  );
}
