"use client";

import { useState, type ReactNode } from "react";
import { OverrideModal } from "./OverrideModal";
import { PERM_LABEL, type PermKey, type PermMode } from "@/lib/permission-keys";

export type Approval = { token: string; nonce: string };

/**
 * Promise-based super admin approval for role-gated actions ("Needs
 * approval" in WMS POS roles). Render `modal` somewhere in the component.
 *
 *   const { gate, modal } = useApproval();
 *   const ok = await gate("pos_register.cash_drop", mode, "Cash drop of $50");
 *   if (ok === null) return;           // hidden, or approval cancelled
 *   fetch(..., { body: { ...payload, approval: ok } })   // ok = {} when no approval needed
 */
export function useApproval(): {
  gate: (key: PermKey, mode: PermMode, detail: string) => Promise<Partial<Approval> | null>;
  modal: ReactNode;
} {
  const [req, setReq] = useState<{
    key: PermKey;
    nonce: string;
    detail: string;
    resolve: (a: Approval | null) => void;
  } | null>(null);

  function gate(key: PermKey, mode: PermMode, detail: string): Promise<Partial<Approval> | null> {
    if (mode === "view") return Promise.resolve({});
    if (mode === "hide") {
      window.alert(`Your role isn't allowed to ${PERM_LABEL[key]}.`);
      return Promise.resolve(null);
    }
    return new Promise((resolve) =>
      setReq({ key, nonce: crypto.randomUUID(), detail, resolve }),
    );
  }

  const modal = req ? (
    <OverrideModal
      kind="permission"
      refId={`${req.key}:${req.nonce}`}
      title={`Approval needed to ${PERM_LABEL[req.key]}`}
      detail={req.detail}
      onCancel={() => {
        req.resolve(null);
        setReq(null);
      }}
      onApproved={(token) => {
        req.resolve({ token, nonce: req.nonce });
        setReq(null);
      }}
    />
  ) : null;

  return { gate, modal };
}
