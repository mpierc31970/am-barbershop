// CDS Support (12-19 choices 3, 4; COMM-01, COMM-02, COMM-05, COMM-07, D83, D311; 12-UI-SPEC
// "Support frame" lines 247-270, "Messages" 274-297, states 735-737). Replaces the P11 interim
// screen at the same URL.
//   - SupportFrame (CDS identity root, Get help, tabs, email fallback footer) around the tab.
//   - `?tab=` is parsed against SUPPORT_TABS and dispatched through SUPPORT_PANELS (tab id ->
//     server panel): `messages` (12-19), `tickets`, `documents`, `ideas` (12-25). An
//     unknown tab shows Messages.
//   - Access: support:write -> write; read-only roles -> viewer (VIEWER-READONLY); staff
//     impersonating -> impersonating (IMPERSONATING-SUPPORT). Grants-only roles have no
//     support:read in v1 (P12-P11): the frame with a short notice and the email footer.
//   - The P11 Care Plan row lives in the Tickets tab's Owner-only Your support panel (12-25).
//   - Load failures are logged by class name only and shown as ERR-LOAD / ERR-SECTION.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { can } from "@cds/core";
import {
  carePlanUsage,
  getBusinessProfile,
  getConversation,
  listCdsDocuments,
  listCdsNotes,
  listIdeas,
  listThreadFiles,
  listTickets,
  listThreadMessages,
  readSupportRead,
  resolveMergedIdea,
  supportEmail,
  type CdsNoteItem,
  type OrgContext,
  type ThreadMessagesPage,
} from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import {
  IDEA_STATUSES,
  SUPPORT_UI_COPY,
  type DocumentFrom,
  type IdeaStatus,
  type TicketListShow,
} from "@cds/ui/hub/support";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { HUB_SECTIONS, SUPPORT_TABS, type SupportTabId } from "../sections";
import { DocumentsPanel } from "./DocumentsPanel";
import { IdeasPanel } from "./IdeasPanel";
import { MessagesPanel } from "./MessagesPanel";
import { SupportFrame, type SupportAccess } from "./SupportFrame";
import { TicketsPanel, type CareRow } from "./TicketsPanel";
import { DEFAULT_SUPPORT_EMAIL, careOnLine } from "./support-copy";

export const metadata: Metadata = { title: "Support" };

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type SupportPanelProps = {
  ctx: OrgContext;
  access: SupportAccess;
  timeZone: string;
  params: SearchParams;
};

type SupportPanel = (props: SupportPanelProps) => Promise<ReactNode>;

const NO_ACCESS_COPY =
  "Your role on this site doesn't include Support. Ask your site owner.";

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** `?tab=`: a known tab id, else Messages (UI-SPEC: unknown -> Messages). */
function parseSupportTab(raw: unknown): SupportTabId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return SUPPORT_TABS.some((t) => t.id === v)
    ? (v as SupportTabId)
    : "messages";
}

/** The business's time zone; UTC when it can't be read. */
async function timeZoneOf(ctx: OrgContext): Promise<string> {
  try {
    const profile = await getBusinessProfile(ctx);
    return profile.time_zone || "UTC";
  } catch {
    return "UTC";
  }
}

function LoadError({ tab }: { tab: SupportTabId }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <GuardedLink href={`/hub/support?tab=${tab}`} className={LINK}>
          {SUPPORT_UI_COPY.BUTTONS.tryAgain}
        </GuardedLink>
      }
    >
      {SUPPORT_UI_COPY.ERR_LOAD}
    </InlineAlert>
  );
}

function first(raw: unknown): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" ? v : undefined;
}

/** A document as the list takes it (the unread flag travels as unreadIds). */
function withoutUnread<T extends { unread: boolean }>(
  row: T,
): Omit<T, "unread"> {
  const { unread, ...rest } = row;
  void unread;
  return rest;
}

function SectionError() {
  return (
    <InlineAlert tone="warning">{SUPPORT_UI_COPY.ERR_SECTION}</InlineAlert>
  );
}

const plainNote = ({ unread, ...note }: CdsNoteItem) => ({ ...note, unread });

/** Messages: pinned + earlier notes, the conversation (last 50) and the composer. */
async function MessagesTab({ ctx, access, timeZone }: SupportPanelProps) {
  let notes: { pinned: CdsNoteItem[]; earlier: CdsNoteItem[] } | null = null;
  try {
    notes = await listCdsNotes(ctx);
  } catch (err) {
    console.error(`[hub] support notes failed ${errName(err)}`);
  }

  let threadId: string | null = null;
  let page: ThreadMessagesPage = { messages: [], hasEarlier: false };
  let lastReadAt: string | null = null;
  try {
    const conversation = await getConversation(ctx);
    if (conversation) {
      threadId = conversation.id;
      const [loaded, read] = await Promise.all([
        listThreadMessages(ctx, conversation.id),
        readSupportRead(ctx).catch((err: unknown) => {
          console.error(`[hub] support read state failed ${errName(err)}`);
          return {} as Record<string, string>;
        }),
      ]);
      page = loaded;
      lastReadAt = read[conversation.id] ?? null;
    }
  } catch (err) {
    console.error(`[hub] support conversation failed ${errName(err)}`);
    return <LoadError tab="messages" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {notes ? null : (
        <InlineAlert tone="warning">{SUPPORT_UI_COPY.ERR_SECTION}</InlineAlert>
      )}
      <MessagesPanel
        threadId={threadId}
        messages={page.messages}
        hasEarlier={page.hasEarlier}
        lastReadAt={lastReadAt}
        pinned={(notes?.pinned ?? []).map(plainNote)}
        earlier={(notes?.earlier ?? []).map(plainNote)}
        timeZone={timeZone}
        access={access}
        nowMs={Date.now()}
      />
    </div>
  );
}

/** `?show=`: open (default), closed or all. */
function parseShow(raw: unknown): TicketListShow {
  const v = first(raw);
  return v === "closed" || v === "all" ? v : "open";
}

/** The Owner's Care Plan row (billing:read); a failed read drops the row, not the panel. */
async function careRow(ctx: OrgContext): Promise<CareRow> {
  try {
    const usage = await carePlanUsage(ctx);
    return usage.on
      ? { on: true, line: careOnLine(usage.usedMinutes, usage.monthLabel) }
      : { on: false };
  } catch (err) {
    console.error(`[hub] support care plan failed ${errName(err)}`);
    return null;
  }
}

/**
 * Tickets: every ticket of the org (the list filters Open · Closed · All in place), Waiting
 * on you first; the Owner's Your support panel (12-25 choice 1).
 */
async function TicketsTab({ ctx, access, params }: SupportPanelProps) {
  const owner = can(ctx, "billing", "read");
  let tickets: Awaited<ReturnType<typeof listTickets>>;
  try {
    tickets = await listTickets(ctx, { show: "all" });
  } catch (err) {
    console.error(`[hub] support tickets failed ${errName(err)}`);
    return <SectionError />;
  }
  const support = owner ? { care: await careRow(ctx) } : null;
  return (
    <TicketsPanel
      tickets={tickets}
      show={parseShow(params.show)}
      access={access}
      nowMs={Date.now()}
      support={support}
    />
  );
}

/** `?from=`: all (default), cds or you. */
function parseFrom(raw: unknown): DocumentFrom {
  const v = first(raw);
  return v === "cds" || v === "you" ? v : "all";
}

/** One loaded page per Documents section (the list shows 50, then Show more). */
const DOCS_LOAD = 100;

/** Documents: CDS-shared documents and every thread file (12-25 choice 2). */
async function DocumentsTab({
  ctx,
  access,
  timeZone,
  params,
}: SupportPanelProps) {
  let docs: Awaited<ReturnType<typeof listCdsDocuments>>;
  let files: Awaited<ReturnType<typeof listThreadFiles>>;
  try {
    [docs, files] = await Promise.all([
      listCdsDocuments(ctx, { limit: DOCS_LOAD }),
      listThreadFiles(ctx, { from: "all", limit: DOCS_LOAD }),
    ]);
  } catch (err) {
    console.error(`[hub] support documents failed ${errName(err)}`);
    return <SectionError />;
  }
  return (
    <DocumentsPanel
      cdsDocs={docs.map(withoutUnread)}
      files={files}
      unreadIds={docs.filter((d) => d.unread).map((d) => d.id)}
      from={parseFrom(params.from)}
      moreDocs={docs.length === DOCS_LOAD}
      moreFiles={files.length === DOCS_LOAD}
      timeZone={timeZone}
      access={access}
    />
  );
}

const RECORD_ID = /^[a-z0-9]{15}$/;

/** `?status=`: a known idea status, else null (the default Suggested applies). */
function parseIdeaStatus(raw: unknown): IdeaStatus | null {
  const v = first(raw);
  return IDEA_STATUSES.find((s) => s === v) ?? null;
}

/**
 * Ideas (12-25 choice 3): one status at a time (default Suggested), ranked by votes.
 * `?idea=<id>` follows a merged idea to its target (merged notice) and `?new=<id>` marks the
 * just-posted one; with no `?status=`, the status shown is the one holding that idea.
 */
async function IdeasTab({ ctx, access, timeZone, params }: SupportPanelProps) {
  const asked = parseIdeaStatus(params.status);
  let highlightId: string | null = null;
  let mergedNotice = false;
  const ideaParam = first(params.idea);
  if (ideaParam && RECORD_ID.test(ideaParam)) {
    try {
      const target = await resolveMergedIdea(ctx, ideaParam);
      highlightId = target;
      mergedNotice = target !== ideaParam;
    } catch (err) {
      // A removed or hidden idea: the board without a notice.
      console.error(`[hub] support idea link failed ${errName(err)}`);
    }
  }
  const newParam = first(params.new);
  if (newParam && RECORD_ID.test(newParam)) highlightId = newParam;

  let status: IdeaStatus = asked ?? "suggested";
  let ideas: Awaited<ReturnType<typeof listIdeas>>;
  try {
    if (highlightId && !asked) {
      const all = await Promise.all(
        IDEA_STATUSES.map((s) => listIdeas(ctx, { status: s })),
      );
      const at = all.findIndex((list) =>
        list.some((i) => i.id === highlightId),
      );
      const i = at >= 0 ? at : 0;
      status = IDEA_STATUSES[i]!;
      ideas = all[i]!;
    } else {
      ideas = await listIdeas(ctx, { status });
    }
  } catch (err) {
    console.error(`[hub] support ideas failed ${errName(err)}`);
    return <SectionError />;
  }
  return (
    <IdeasPanel
      ideas={ideas}
      status={status}
      access={access}
      timeZone={timeZone}
      highlightId={highlightId}
      mergedNotice={mergedNotice}
    />
  );
}

/** Tab id -> server panel (12-19 messages; 12-25 tickets, documents, ideas). */
const SUPPORT_PANELS: Readonly<Partial<Record<SupportTabId, SupportPanel>>> =
  Object.freeze({
    messages: MessagesTab,
    tickets: TicketsTab,
    documents: DocumentsTab,
    ideas: IdeasTab,
  });

export default async function SupportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { ctx, org } = await requireHubSession();
  const params: SearchParams = (await searchParams) ?? {};
  const business = org.name || "your site";
  const address = supportEmail() ?? DEFAULT_SUPPORT_EMAIL;

  const readable = can(ctx, "support", "read");
  const access: SupportAccess = ctx.impersonator
    ? "impersonating"
    : can(ctx, "support", "write")
      ? "write"
      : "viewer";

  const requested = parseSupportTab(params.tab);
  const tab: SupportTabId = SUPPORT_PANELS[requested] ? requested : "messages";
  const tabs = HUB_SECTIONS.support.tabs({
    role: ctx.role,
    grants: ctx.grants,
    active: [],
    registry: ADDON_REGISTRY,
  });

  let body: ReactNode;
  if (!readable) {
    body = <InlineAlert tone="info">{NO_ACCESS_COPY}</InlineAlert>;
  } else {
    const Panel = SUPPORT_PANELS[tab] ?? MessagesTab;
    const timeZone = await timeZoneOf(ctx);
    body = await Panel({ ctx, access, timeZone, params });
  }

  return (
    <SupportFrame
      activeTab={tab}
      tabs={tabs}
      access={readable ? access : "viewer"}
      address={address}
      business={business}
      orgId={ctx.orgId}
      from={`/hub/support?tab=${tab}`}
    >
      {body}
    </SupportFrame>
  );
}
