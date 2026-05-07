import { redirect } from "next/navigation";

/**
 * Legacy register picker. Replaced by the inline "Open Register"
 * denomination dialog on the Sales tab. Any direct navigation here
 * (old bookmark, stale link) bounces to /sales/{code} so the cashier
 * lands on the new flow with the four register-action tiles when a
 * session is open, or the OpenRegisterButton when none is.
 */
export default async function LegacyRegisterPickerRedirect({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  redirect(`/sales/${code}`);
}
