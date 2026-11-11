// Inbox unread count for the sidebar badge (CONT-25, D311, D-UI-P7-1; 07-03 seam, filled by
// 07-19): unread, non-spam form_submissions for the session org, read through the @cds/db
// forms chokepoint. Takes the session ctx only (never an org id from the request,
// T-07-03-04); content read is checked by the layout and again by the chokepoint.
import { countSubmissions } from "@cds/db";
import type { HubSession } from "../../../../lib/session";

export async function inboxUnreadCount(
  ctx: HubSession["ctx"],
): Promise<number> {
  return (await countSubmissions(ctx)).unread;
}
