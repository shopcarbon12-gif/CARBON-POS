/**
 * Store-credit approval policy.
 *
 * The "approver" (a.k.a. super admin) can adjust store credit directly.
 * Everyone else must request an emailed code that goes to the approver and
 * authorizes one specific amount. The approver is identified by email so it
 * stays correct regardless of POS role strings; defaults to Elior and is
 * overridable via STORE_CREDIT_APPROVER_EMAIL.
 */
export function storeCreditApproverEmail(): string {
  return (process.env.STORE_CREDIT_APPROVER_EMAIL || "elior@carbonjeanscompany.com")
    .trim()
    .toLowerCase();
}

export function isStoreCreditApprover(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === storeCreditApproverEmail();
}
