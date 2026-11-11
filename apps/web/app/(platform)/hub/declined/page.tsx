// /hub/declined (10-32; BILL-09, D214). Hub pages send a declined site's members here
// (requireHubSession); the hub layout renders the declined notice in the focused frame, so
// this page adds nothing. Anyone else is sent back to the hub.
import { redirect } from "next/navigation";
import { getDeclinedSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export default async function DeclinedPage() {
  if (!(await getDeclinedSession())) redirect("/hub");
  return null;
}
