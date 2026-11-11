// Marketing › Contacts (07-16 replaces the 07-03 shell; CONTACTS-01/02, D236, D266, D132,
// D-UI-P7-21/22, D311; 07-UI-SPEC "Contacts", "Contacts CSV import"; T-07-16-01, T-07-16-03).
// Server panel: reads the list page, the used tags, the lists and (with &contact=<id>) the open
// contact, then hands plain props to ContactsPanel. The org comes only from the session, and
// every URL value goes through parseContactsParams first (unknown values dropped, never
// thrown). The UI shows exactly the rows the chokepoint returns for the reader's lists
// (D266), and the List filter only when there are 2+ lists. A contact that is gone shows the
// GONE alert over the list; any other failure rethrows so marketing/page.tsx shows ERR-LOAD.
// The page's loading.tsx shows the 8 skeleton rows while this streams in.
import { NotFound, can } from "@cds/core";
import {
  getBusinessProfile,
  getContact,
  listContactLists,
  listContactTags,
  listContacts,
  type ContactDetail,
  type OrgContext,
} from "@cds/db";
import type { JSX } from "react";
import { requireHubSession } from "../../../../lib/session";
import { ContactsPanel } from "./ContactsPanel";
import { CONTACTS_PER_PAGE, parseContactsParams } from "./contacts-params";

export type SearchParams = Record<string, string | string[] | undefined>;

/** The business's time zone; UTC when it can't be read (staff and renters can't read it). */
async function timeZoneOf(ctx: OrgContext): Promise<string> {
  try {
    const profile = await getBusinessProfile(ctx);
    return profile.time_zone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function ContactsTab(
  searchParams: SearchParams,
): Promise<JSX.Element> {
  const { ctx } = await requireHubSession();
  const params = parseContactsParams(searchParams);
  const canWrite = can(ctx, "contacts", "write");
  const scope = params.list ? { list: params.list } : {};

  const [page, tags, lists, timeZone] = await Promise.all([
    listContacts(ctx, {
      ...(params.q ? { q: params.q } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.tag ? { tag: params.tag } : {}),
      ...(params.consent ? { consent: params.consent } : {}),
      ...scope,
      sort: params.sort ?? "last_seen",
      ...(params.page ? { page: params.page } : {}),
      perPage: CONTACTS_PER_PAGE,
    }),
    listContactTags(ctx, scope),
    listContactLists(ctx),
    timeZoneOf(ctx),
  ]);

  let open: ContactDetail | null = null;
  let gone = false;
  if (params.contact && params.contact !== "new") {
    try {
      open = params.list
        ? await getContact(ctx, params.contact, scope)
        : await getContact(ctx, params.contact);
    } catch (err) {
      if (err instanceof NotFound) gone = true;
      else throw err;
    }
  }

  return (
    <ContactsPanel
      rows={page.items}
      page={page.page}
      totalItems={page.totalItems}
      totalPages={page.totalPages}
      tags={tags}
      lists={lists.length >= 2 ? lists : []}
      params={params}
      open={
        open
          ? {
              contact: open.contact,
              detail: { events: open.events, notes: open.notes },
            }
          : null
      }
      canWrite={canWrite}
      timeZone={timeZone}
      gone={gone}
    />
  );
}
