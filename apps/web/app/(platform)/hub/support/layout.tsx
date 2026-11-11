// A&M fork: barber seats (renter, staff) have no CDS Support (not in their sidebar either);
// every /hub/support/** page answers not found for them.
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireHubSession } from "../../../../lib/session";

export default async function SupportLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { ctx } = await requireHubSession();
  if (ctx.role === "renter" || ctx.role === "staff") notFound();
  return children;
}
