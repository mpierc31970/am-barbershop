// P12 support Needs-you provider (12-24; COMM-03, COMM-10, COMM-11, SUPPORT-03, DASH-27;
// RESEARCH Pattern 4, Pitfall 4; UI-SPEC "Needs you rows"). Fills P11's `cds` slot in
// today/needs-you.ts, so Today, the Support badges and bell clearing share one list.
//
// Per person, using member_prefs.support_read:
// - `support:ticket:<n>`: one item per open ticket, priority paid choice > waiting on you >
//   CDS replied. Tickets reach the filer plus Owners and Admins; the paid choice only the
//   Owner (`feature: "billing"`), so an Admin sees the same ticket as "waiting on you".
// - `support:messages`: unread public CDS messages in the conversation, else unread notes.
// - `support:held:<draftId>`: the person's own held drafts whose target is no longer locked.
// - `support:notice:<windowId>`: active organization, add-on or platform windows (urgent).
// Keys `support:ticket:<n>` and `support:messages` match the alert keys 12-05 raises, so those
// bell rows clear with their items. Items carry `feature`/`access` for listNeedsYou's grant
// filter. Reads fail loudly (the provider lands in `failed` and its bell rows are kept).
import { can, type Action } from "@cds/core";
import { paidAwaitingChoice } from "@cds/core/support";
import type { NeedsYouItem } from "@cds/core/today";
import type { RecordModel } from "pocketbase";
import { activeAddons } from "../addons/entitlements";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { readSupportRead } from "../today/prefs";
import { listHeldDrafts, type HeldDraftView } from "./held-drafts";
import { CONVERSATION_HREF } from "./messages";
import { listCdsNotes } from "./notes-docs";
import { MESSAGES, THREADS, findConversation } from "./shared";
import { ticketPaidView } from "./threads";
import { activeServiceNotices } from "./windows";

/** A support item with the grant listNeedsYou checks before showing it. */
export type SupportNeedsYouItem = NeedsYouItem & {
  feature: string;
  access: Action;
};

export type SupportNeedsYouOpts = {
  /** Add-on display names for held-draft labels (the registry; db never imports it). */
  addonName?: (slug: string) => string | undefined;
};

const TICKETS_MAX = 200;
const MESSAGE_SUB_CHARS = 60;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function ms(v: unknown): number {
  const t = Date.parse(str(v).replace(" ", "T"));
  return Number.isFinite(t) ? t : Number.NaN;
}

function isoOr(v: unknown, fallback: string): string {
  const t = ms(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
function ago(at: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function unread(cdsAt: number, readAt: string | undefined): boolean {
  if (!Number.isFinite(cdsAt)) return false;
  const seen = Date.parse(readAt ?? "");
  return !Number.isFinite(seen) || seen < cdsAt;
}

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > MESSAGE_SUB_CHARS
    ? `${flat.slice(0, MESSAGE_SUB_CHARS - 1).trimEnd()}…`
    : flat;
}

// ---------------------------------------------------------------------------------------
// Tickets

function ticketItem(
  ctx: OrgContext,
  row: RecordModel,
  read: Readonly<Record<string, string>>,
  now: Date,
): SupportNeedsYouItem | null {
  const number = Number(row.number) || 0;
  if (number <= 0) return null;
  const subject = str(row.subject);
  const base = {
    key: `support:ticket:${number}`,
    level: "normal" as const,
    href: `/hub/support/tickets/${number}`,
    section: "support" as const,
    tab: "tickets",
  };
  const paid = ticketPaidView(row.paid_service);
  // Owner only: the choice is open, i.e. nothing picked yet, or a sent quote to accept. A
  // requested quote that CDS has not sent yet waits on CDS, not on the Owner.
  const ownerChoice =
    !!paid &&
    paidAwaitingChoice(paid) &&
    (!!paid.work_order || !paid.quote_requested_at);
  if (paid && ownerChoice && can(ctx, "billing", "read")) {
    return {
      ...base,
      kind: "support.paid_choice",
      title: `Choose how to handle ticket #${number}`,
      sub: "This is a paid service",
      actionLabel: "Choose an option",
      at: isoOr(paid.quote_sent_at || paid.marked_at, now.toISOString()),
      feature: "billing",
      access: "read",
    };
  }
  if (row.status === "waiting_on_you") {
    return {
      ...base,
      kind: "support.waiting",
      title: `Ticket #${number} is waiting on you`,
      ...(subject ? { sub: subject } : {}),
      actionLabel: "Reply",
      at: isoOr(row.last_activity_at, now.toISOString()),
      feature: "support",
      access: "read",
    };
  }
  const cdsAt = ms(row.last_cds_activity_at);
  if (unread(cdsAt, read[row.id])) {
    const when = ago(cdsAt, now.getTime());
    return {
      ...base,
      kind: "support.reply",
      title: `Support replied to ticket #${number}`,
      sub: subject ? `${subject} · ${when}` : when,
      actionLabel: "Read reply",
      at: new Date(cdsAt).toISOString(),
      feature: "support",
      access: "read",
    };
  }
  return null;
}

async function ticketItems(
  ctx: OrgContext,
  read: Readonly<Record<string, string>>,
  now: Date,
): Promise<SupportNeedsYouItem[]> {
  // The filer, plus Owners and Admins (UI-SPEC "Needs you rows": "filer + Owner/Admin").
  const all = ctx.role === "owner" || ctx.role === "admin";
  if (!all && !ctx.actor) return [];
  const rows = await withSuperuser((pb) =>
    pb.collection(THREADS).getList(1, TICKETS_MAX, {
      filter: all
        ? pb.filter(
            "organization = {:org} && kind = 'ticket' && status != 'closed'",
            { org: ctx.orgId },
          )
        : pb.filter(
            "organization = {:org} && kind = 'ticket' && status != 'closed' && opened_by = {:me}",
            { org: ctx.orgId, me: ctx.actor ?? "" },
          ),
      sort: "-last_activity_at,-number",
      skipTotal: true,
    }),
  );
  return rows.items
    .map((r) => ticketItem(ctx, r, read, now))
    .filter((i): i is SupportNeedsYouItem => i !== null);
}

// ---------------------------------------------------------------------------------------
// Conversation and notes

async function messagesItem(
  ctx: OrgContext,
  read: Readonly<Record<string, string>>,
  now: Date,
): Promise<SupportNeedsYouItem | null> {
  const base = {
    key: "support:messages",
    level: "normal" as const,
    href: CONVERSATION_HREF,
    section: "support" as const,
    tab: "messages",
    feature: "support",
    access: "read" as const,
  };
  const latest = await withSuperuser(async (pb) => {
    const thread = await findConversation(pb, ctx.orgId);
    if (!thread) return null;
    if (!unread(ms(thread.last_cds_activity_at), read[thread.id])) return null;
    const msgs = await pb.collection(MESSAGES).getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && thread = {:t} && visibility = 'public' && author_kind != 'member'",
        { org: ctx.orgId, t: thread.id },
      ),
      sort: "-created,-id",
      skipTotal: true,
    });
    return { thread, message: msgs.items[0] ?? null };
  });
  if (latest) {
    const body = excerpt(str(latest.message?.body));
    return {
      ...base,
      kind: "support.message",
      title: "New message from Support",
      ...(body ? { sub: body } : {}),
      actionLabel: "Read message",
      at: isoOr(
        latest.message?.created ?? latest.thread.last_cds_activity_at,
        now.toISOString(),
      ),
    };
  }
  const notes = await listCdsNotes(ctx);
  const newest = [...notes.pinned, ...notes.earlier]
    .filter((n) => n.unread)
    .sort((a, b) => ms(b.created) - ms(a.created))[0];
  if (!newest) return null;
  return {
    ...base,
    kind: "support.note",
    title: `New note from Support: ${newest.title}`,
    actionLabel: "Read note",
    at: isoOr(newest.created, now.toISOString()),
  };
}

// ---------------------------------------------------------------------------------------
// Held drafts

const PART_TAB: Readonly<Record<string, { tab: string; label: string }>> = {
  nav: { tab: "navigation", label: "Navigation" },
  footer: { tab: "footer", label: "Footer" },
  banner: { tab: "banner", label: "Banner" },
  settings: { tab: "site", label: "Site settings" },
};

function humanSlug(slug: string): string {
  const s = slug.replace(/[-_]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : "your add-on";
}

async function heldItems(
  ctx: OrgContext,
  now: Date,
  opts: SupportNeedsYouOpts,
): Promise<SupportNeedsYouItem[]> {
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return [];
  // The person's own drafts only (listHeldDrafts filters by user; T-12-24-02).
  const drafts = (await listHeldDrafts(ctx, { now })).filter((d) => !d.locked);
  if (drafts.length === 0) return [];
  const pageIds = [
    ...new Set(
      drafts.flatMap((d) => (d.target.kind === "page" ? [d.target.id] : [])),
    ),
  ];
  const titles = new Map<string, string>();
  if (pageIds.length > 0) {
    // At most a handful of held pages per person: one scoped read each (static filter).
    await withSuperuser(async (pb) => {
      for (const id of pageIds) {
        const res = await pb.collection("pages").getList(1, 1, {
          filter: pb.filter("organization = {:org} && id = {:id}", {
            org: ctx.orgId,
            id,
          }),
          fields: "id,title",
          skipTotal: true,
        });
        const p = res.items[0];
        if (p) titles.set(p.id, str(p.title));
      }
    });
  }
  const out: SupportNeedsYouItem[] = [];
  for (const d of drafts) {
    const where = heldWhere(d, titles, opts);
    if (!where) continue;
    out.push({
      key: `support:held:${d.id}`,
      kind: "support.held",
      level: "normal",
      title: `Your changes to ${where.label} are waiting`,
      sub: "Support has finished its work.",
      actionLabel: "Review changes",
      href: where.href,
      section: "website",
      tab: where.tab,
      at: isoOr(d.savedAt, now.toISOString()),
      feature: where.feature,
      access: "write",
    });
  }
  return out;
}

function heldWhere(
  d: HeldDraftView,
  titles: ReadonlyMap<string, string>,
  opts: SupportNeedsYouOpts,
): { label: string; href: string; tab: string; feature: string } | null {
  const t = d.target;
  if (t.kind === "page") {
    const title = titles.get(t.id);
    if (title === undefined) return null; // page gone: nothing to review
    return {
      label: title || "a page",
      href: `/hub/website/pages/${encodeURIComponent(t.id)}`,
      tab: "pages",
      feature: "content",
    };
  }
  if (t.kind === "part") {
    const part = PART_TAB[d.ref] ?? { tab: "pages", label: "your site" };
    return {
      label: part.label,
      href: `/hub/website?tab=${part.tab}`,
      tab: part.tab,
      feature: "content",
    };
  }
  if (t.kind === "addon") {
    return {
      label: opts.addonName?.(t.slug) || humanSlug(t.slug),
      href: `/hub/website?tab=${encodeURIComponent(t.slug)}`,
      tab: t.slug,
      feature: `addon:${t.slug}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Planned work

async function noticeItems(
  ctx: OrgContext,
  now: Date,
): Promise<SupportNeedsYouItem[]> {
  const notices = await activeServiceNotices(ctx, {
    activeAddons: await activeAddons(ctx),
    now,
  });
  return notices
    .filter(
      (n) =>
        n.phase === "active" &&
        (n.scope === "organization" ||
          n.scope === "addon" ||
          n.scope === "platform"),
    )
    .map((n) => {
      const message = n.message.trim();
      let title = n.text.trim();
      if (message && title.endsWith(message)) {
        title = title.slice(0, -message.length).trim();
      }
      title = title.replace(/\.$/, "");
      return {
        key: `support:notice:${n.id}`,
        kind: "support.notice",
        level: "urgent" as const,
        title,
        ...(message ? { sub: message } : {}),
        actionLabel: "See details",
        href: CONVERSATION_HREF,
        section: "support" as const,
        tab: "messages",
        at: isoOr(n.startsAt, now.toISOString()),
        feature: "support",
        access: "read" as const,
      };
    });
}

/**
 * The person's support Needs-you items (12-24 choice 1). The caller (listNeedsYou) has
 * already checked `support:read`; every item carries its own grant for the final filter.
 * Viewers get nothing. A failed read throws, so the provider is named in `failed`.
 */
export async function supportNeedsYou(
  ctx: OrgContext,
  now: Date = new Date(),
  opts: SupportNeedsYouOpts = {},
): Promise<SupportNeedsYouItem[]> {
  assertOrgContext(ctx);
  if (ctx.role === "viewer" || !can(ctx, "support", "read")) return [];
  const read = await readSupportRead(ctx);
  const [tickets, messages, held, notices] = await Promise.all([
    ticketItems(ctx, read, now),
    messagesItem(ctx, read, now),
    heldItems(ctx, now, opts),
    noticeItems(ctx, now),
  ]);
  return [...notices, ...tickets, ...(messages ? [messages] : []), ...held];
}
