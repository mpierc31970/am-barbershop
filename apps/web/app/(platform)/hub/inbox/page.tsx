// Inbox (CONT-25; D231, D271, D311, D-UI-P7-1, D-UI-P7-20; 07-UI-SPEC "Inbox (/hub/inbox)",
// "Hub shell changes (D311)"; 07-03 shell, 07-19 list + drawer; T-07-03-01, T-07-19-08,
// T-07-19-09). /hub/inbox?tab=messages|filtered[&form=<id>][&q=…][&message=<id>]. ScreenHeader
// "Inbox" + "?" (help id `inbox.<tab>`; 11-47, DASH-17), the TabLinks bar from HUB_SECTIONS
// (DASH-25; Messages · "Filtered · 3"), then the panel: toolbar, list, drawer.
// Access follows content:read (Owner, Admin, Editor, Viewer); everyone else gets a 404 before
// anything renders. The org comes only from the session, and every URL value goes through
// parseInboxParams first (unknown values dropped, never thrown).
//   - A message in the URL is read for the drawer, never marked read here (choice 7): the
//     client marks it on open, so prefetching a link changes nothing.
//   - A message or form that is gone shows the GONE alert over the list; any other failure
//     shows ERR-LOAD. loading.tsx shows the 5 skeleton rows while this streams in (the
//     page awaits its reads, so the route's loading.tsx is the Suspense boundary).
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { NotFound, can } from "@cds/core";
import {
  countSubmissions,
  getBusinessProfile,
  getSubmission,
  listForms,
  listSubmissions,
  type OrgContext,
  type SubmissionDetail,
  type SubmissionPage,
} from "@cds/db";
import {
  InlineAlert,
  TabLinks,
  buttonClasses,
  filteredTabLabel,
} from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX } from "react";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { HUB_SECTIONS } from "../sections";
import { InboxPanel } from "./InboxPanel";
import {
  INBOX_PER_PAGE,
  inboxHref,
  parseInboxParams,
  type InboxParams,
  type InboxTab,
} from "./inbox-params";

export const metadata: Metadata = { title: "Inbox" };

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

/** The business's time zone; UTC when it can't be read. */
async function timeZoneOf(ctx: OrgContext): Promise<string> {
  try {
    const profile = await getBusinessProfile(ctx);
    return profile.time_zone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The Filtered count for the tab label; 0 when it can't be read (the list still loads). */
async function filteredCountOf(ctx: OrgContext): Promise<number> {
  try {
    return (await countSubmissions(ctx)).filtered;
  } catch (err) {
    console.error("[hub] inbox count failed", err);
    return 0;
  }
}

function LoadError({ params }: { params: InboxParams }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <Link
          href={inboxHref(params, { message: undefined })}
          className={buttonClasses("secondary", "sm")}
        >
          Try again
        </Link>
      }
    >
      We couldn&apos;t load this. Check your connection and try again.
    </InlineAlert>
  );
}

async function InboxData(
  ctx: OrgContext,
  params: InboxParams,
  siteName: string,
): Promise<JSX.Element> {
  const read = (form: string | undefined): Promise<SubmissionPage> =>
    listSubmissions(ctx, {
      view: params.tab,
      ...(form ? { form } : {}),
      ...(params.q ? { q: params.q } : {}),
      perPage: INBOX_PER_PAGE,
    });

  let formGone = false;
  const listing = read(params.form).catch((err: unknown) => {
    // A form id that isn't this org's (or was hard-deleted): list without it.
    if (err instanceof NotFound && params.form) {
      formGone = true;
      return read(undefined);
    }
    throw err;
  });
  const [page, forms, timeZone] = await Promise.all([
    listing,
    listForms(ctx, { includeDeleted: true }),
    timeZoneOf(ctx),
  ]);

  let open: SubmissionDetail | null = null;
  let gone = false;
  if (params.message) {
    try {
      open = await getSubmission(ctx, params.message);
    } catch (err) {
      if (err instanceof NotFound) gone = true;
      else throw err;
    }
  }

  return (
    <InboxPanel
      params={formGone ? { ...params, form: undefined } : params}
      rows={page.items}
      page={page.page}
      totalPages={page.totalPages}
      forms={forms.map((f) => ({ id: f.id, name: f.name, deleted: f.deleted }))}
      open={open}
      gone={gone}
      formGone={formGone}
      canWrite={can(ctx, "content", "write")}
      canContacts={can(ctx, "contacts", "read")}
      timeZone={timeZone}
      siteName={siteName}
      nowIso={new Date().toISOString()}
    />
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx, org } = await requireHubSession();
  if (!can(ctx, "content", "read")) notFound();
  const params = parseInboxParams(await searchParams);
  const filtered = await filteredCountOf(ctx);

  let panel: JSX.Element;
  try {
    panel = await InboxData(ctx, params, org?.name ?? "");
  } catch (err) {
    console.error("[hub] inbox failed", err);
    panel = <LoadError params={params} />;
  }

  // Ids, order and hrefs from HUB_SECTIONS; Filtered keeps its own held-message count.
  const tabs = HUB_SECTIONS.inbox
    .tabs({
      role: ctx.role,
      grants: ctx.grants,
      active: [],
      registry: ADDON_REGISTRY,
    })
    .map((t) => ({
      id: t.id as InboxTab,
      label: t.id === "filtered" ? filteredTabLabel(filtered) : t.label,
    }));

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title="Inbox"
        helpId={`inbox.${params.tab}`}
        LinkComponent={GuardedLink}
      />
      <TabLinks
        label="Inbox sections"
        activeId={params.tab}
        tabs={tabs.map((t) => ({
          id: t.id,
          label: t.label,
          href: inboxHref(params, {
            tab: t.id,
            message: undefined,
          }),
        }))}
        LinkComponent={GuardedLink}
      />
      <div key={params.tab}>{panel}</div>
    </div>
  );
}
