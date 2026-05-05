"use client";

import { signOut } from "next-auth/react";
import { SellScreen } from "@/components/pos/SellScreen";

export function SellScreenWrapper({
  taxRate,
  registerName,
}: {
  taxRate: number;
  registerName: string;
}) {
  return (
    <SellScreen
      taxRate={taxRate}
      registerName={registerName}
      onSignOut={() => signOut({ callbackUrl: "/sign-in" })}
    />
  );
}
