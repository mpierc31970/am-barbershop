// P12 Suggest a feature board (12-22; CUSTOM-01, D297; RESEARCH Pattern 9, Pitfall 11).
//
// Tenant side:
// - submitIdea: a private `suggestion` ticket (no SLA; the description is its first message)
//   plus a public `feature_ideas` card and the site's own vote, in one batch after the ticket
//   row. The keyword ContentScanner seam runs on the text; anything not clean is held hidden
//   (`hold_reason = "review"`) for staff review (T-12-22-02).
// - listIdeas: visible, unmerged ideas of one status, ranked `-votes, -created`, as IdeaCard.
//   Built field by field: `mine` compares `source_org` server-side; `source_org` and
//   `source_thread` never leave this module (T-12-22-01).
// - toggleIdeaVote: one vote per org (unique (organization, idea)); a concurrent double vote is
//   one vote; `votes` is recounted with a count query, never incremented (T-12-22-03).
// - resolveMergedIdea: a merged idea's old link → the idea it now lives in.
//
// Staff side (`ideas_run`; the CLI is 12-30): list (hidden included, source business name for
// staff), set status (resolves linked suggestion tickets; Built tells voters' orgs), merge
// (votes moved with per-org dedupe), hide / unhide, edit. Every staff write is audited with
// no organization.
import { InvalidInput, NotFound, authorizeStaff } from "@cds/core";
import {
  WHOLE_SITE,
  ticketTypesFor,
  type IdeaCard,
  type TicketStatus,
} from "@cds/core/support";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import type { ContentScanner } from "../content/ports";
import { getContentScanner, keywordScanner } from "../content/scan-standin";
import { usesKeywordTextStandIn } from "../content/scan/composite";
import {
  assertOrgContext,
  assertPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { isUniqueViolation } from "../payments/staff-alert";
import { beginSupportAction } from "../rate-limit";
import { assertId, newRecordId, requirePermission } from "../repository";
import { notifySupport, type SupportNotifyDeps } from "./notify";
import {
  THREADS,
  appendMessage,
  assertMemberWriter,
  errName,
  isOpenOrg,
  memberDisplayName,
} from "./shared";
import {
  applyTicketTransition,
  createTicketRow,
  ratedAgentFor,
} from "./threads";

const IDEAS = "feature_ideas";
const VOTES = "feature_idea_votes";
const ID_RE = /^[a-z0-9]{15}$/;
/** P12-P5. */
export const IDEA_TITLE_MAX = 80;
export const IDEA_DESCRIPTION_MAX = 2000;
const LIST_MAX = 500;
const MERGE_HOPS = 10;
export const IDEA_HOLD_REVIEW = "review";
export const IDEA_HOLD_STAFF = "staff";
/** 12-REVIEW WR-A07: the suggesting site was deleted; staff may edit and unhide it. */
export const IDEA_HOLD_SOURCE_DELETED = "source_deleted";

export type IdeaStatus = IdeaCard["status"];
export const IDEA_STATUSES: readonly IdeaStatus[] = [
  "suggested",
  "considering",
  "planned",
  "built",
];
const STATUS_LABEL: Readonly<Record<IdeaStatus, string>> = {
  suggested: "Suggested",
  considering: "Considering",
  planned: "Planned",
  built: "Built",
};

export type IdeaClock = { now(): Date };
const SYSTEM_CLOCK: IdeaClock = { now: () => new Date() };

export type IdeaDeps = {
  clock?: IdeaClock;
  scanner?: ContentScanner;
  transport?: SupportNotifyDeps["transport"];
  push?: SupportNotifyDeps["push"];
  types?: SupportNotifyDeps["types"];
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function iso(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function nowOf(clock?: IdeaClock): Date {
  const now = (clock ?? SYSTEM_CLOCK).now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("clock must return a valid date");
  }
  return now;
}

function isIdeaStatus(v: unknown): v is IdeaStatus {
  return typeof v === "string" && (IDEA_STATUSES as string[]).includes(v);
}

function statusOf(v: unknown): IdeaStatus {
  return isIdeaStatus(v) ? v : "suggested";
}

function cleanTitle(v: unknown): string {
  if (typeof v !== "string") throw new InvalidInput("idea must be text");
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) throw new InvalidInput("name the idea");
  if (s.length > IDEA_TITLE_MAX) {
    throw new InvalidInput(`idea must be at most ${IDEA_TITLE_MAX} characters`);
  }
  return s;
}

function cleanDescription(v: unknown): string {
  if (typeof v !== "string") throw new InvalidInput("description must be text");
  const s = v.trim();
  if (!s) throw new InvalidInput("describe the idea");
  if (s.length > IDEA_DESCRIPTION_MAX) {
    throw new InvalidInput(
      `description must be at most ${IDEA_DESCRIPTION_MAX} characters`,
    );
  }
  return s;
}

function ideaId(v: unknown): string {
  if (typeof v !== "string" || !ID_RE.test(v.trim())) {
    throw new NotFound("idea not found");
  }
  return v.trim();
}

async function loadIdea(pb: PocketBase, raw: unknown): Promise<RecordModel> {
  const id = ideaId(raw);
  try {
    return await pb.collection(IDEAS).getOne(id);
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound("idea not found");
    }
    throw err;
  }
}

/** Visible to tenants: not hidden, not merged. */
function isListed(row: RecordModel): boolean {
  return !iso(row.hidden_at) && !str(row.merged_into);
}

async function countVotes(pb: PocketBase, idea: string): Promise<number> {
  const res = await pb.collection(VOTES).getList(1, 1, {
    filter: pb.filter("idea = {:idea}", { idea }),
    fields: "id",
  });
  return res.totalItems;
}

/** Recounts `votes` from the vote rows (never increments, T-12-22-03). */
async function recountVotes(pb: PocketBase, idea: string): Promise<number> {
  const votes = await countVotes(pb, idea);
  await pb.collection(IDEAS).update(idea, { votes });
  return votes;
}

async function orgVote(
  pb: PocketBase,
  orgId: string,
  idea: string,
): Promise<RecordModel | null> {
  const res = await pb.collection(VOTES).getList(1, 1, {
    filter: pb.filter("organization = {:org} && idea = {:idea}", {
      org: orgId,
      idea,
    }),
  });
  return res.items[0] ?? null;
}

/** IdeaCard, field by field (T-12-22-01): never `source_org` or `source_thread`. */
function toCard(row: RecordModel, orgId: string, voted: boolean): IdeaCard {
  return {
    id: row.id,
    title: str(row.title),
    description: str(row.description),
    status: statusOf(row.status),
    votes: typeof row.votes === "number" ? row.votes : 0,
    voted,
    mine: str(row.source_org) === orgId,
    created: str(row.created),
  };
}

// ---------------------------------------------------------------------------------------
// Tenant (choices 1-3)

export type SubmitIdeaInput = { title: string; description: string };
export type SubmitIdeaResult = {
  ideaId: string;
  /** The suggestion ticket's number. */
  number: number;
  /** The scanner held it back for staff review (not listed yet). */
  held: boolean;
};

/**
 * Suggest a feature (choice 1; `support:write`, Viewers Forbidden, impersonation refused).
 * Counts against the 20-tickets-a-day limit. Creates the suggestion ticket (description as the
 * first message), the idea card and this site's vote; held hidden when the scanner flags it.
 */
export async function submitIdea(
  ctx: OrgContext,
  input: SubmitIdeaInput,
  deps: Pick<IdeaDeps, "clock" | "scanner"> = {},
): Promise<SubmitIdeaResult> {
  assertOrgContext(ctx);
  requirePermission(ctx, "support", "write");
  assertMemberWriter(ctx);
  if (!ticketTypesFor(ctx.role).includes("suggestion")) {
    throw new InvalidInput("choose a ticket type");
  }
  const title = cleanTitle(input?.title);
  const description = cleanDescription(input?.description);
  const now = nowOf(deps.clock);
  beginSupportAction("ticket", { orgId: ctx.orgId });
  const scanner = deps.scanner ?? getContentScanner();
  const verdict = (
    await scanner.scan({
      orgId: ctx.orgId,
      texts: [title, description],
      urls: [],
    })
  ).verdict;
  // Anything not clean waits for a person (Pitfall 11): held and unsure alike.
  // 12-REVIEW WR-A07: the keyword stand-in cannot catch business or client names, and an
  // idea is shown to every other site, so while it is the scanner every idea waits for staff.
  const held =
    verdict !== "clean" ||
    scanner === keywordScanner ||
    usesKeywordTextStandIn(scanner);
  return withSuperuser(async (pb) => {
    const authorName = await memberDisplayName(pb, ctx.actor);
    const thread = await createTicketRow(pb, {
      orgId: ctx.orgId,
      type: "suggestion",
      subject: title,
      target: WHOLE_SITE,
      context: null,
      openedBy: ctx.actor,
      now,
    });
    const number = Number(thread.number);
    const id = newRecordId();
    try {
      const batch = pb.createBatch();
      const messageId = appendMessage(
        pb,
        batch,
        {
          orgId: ctx.orgId,
          thread,
          authorKind: "member",
          authorUser: ctx.actor,
          authorName,
          body: description,
          visibility: "public",
        },
        now,
      );
      // Created with its one vote in the same batch: the count is exact, not incremented.
      batch.collection(IDEAS).create({
        id,
        title,
        description,
        status: "suggested",
        votes: 1,
        source_org: ctx.orgId,
        source_thread: thread.id,
        hidden_at: held ? now.toISOString() : "",
        hold_reason: held ? IDEA_HOLD_REVIEW : "",
        merged_into: "",
      });
      batch.collection(VOTES).create({
        organization: ctx.orgId,
        idea: id,
        voted_by: ctx.actor,
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "support.idea_suggested",
          organization: ctx.orgId,
          targetCollection: THREADS,
          targetId: thread.id,
          meta: { number, idea: id, held, message: messageId },
        }),
      );
      await batch.send();
    } catch (err) {
      // No suggestion ticket without its card and description.
      await pb
        .collection(THREADS)
        .delete(thread.id)
        .catch(() => undefined);
      throw err;
    }
    return { ideaId: id, number, held };
  });
}

/**
 * 12-REVIEW WR-A07: retention, before a deleted site's rows go. Removes its votes and recounts
 * the ideas it voted for; ideas it suggested lose their source fields and are hidden (held
 * for staff, IDEA_HOLD_SOURCE_DELETED) so its text does not outlive it on the board.
 */
export async function releaseDeletedOrgIdeas(
  orgId: string,
  now: Date,
): Promise<{ recounted: number; hidden: number }> {
  if (!ID_RE.test(orgId)) throw new InvalidInput("invalid organization id");
  return withSuperuser(async (pb) => {
    const votes = await pb.collection(VOTES).getFullList({
      filter: pb.filter("organization = {:org}", { org: orgId }),
      fields: "id,idea",
    });
    const touched = new Set<string>();
    for (const v of votes) {
      await pb.collection(VOTES).delete(v.id);
      if (str(v.idea)) touched.add(str(v.idea));
    }
    let recounted = 0;
    for (const idea of touched) {
      const ok = await recountVotes(pb, idea).then(
        () => true,
        () => false,
      );
      if (ok) recounted++;
    }
    const sourced = await pb.collection(IDEAS).getFullList({
      filter: pb.filter("source_org = {:org}", { org: orgId }),
      fields: "id,hidden_at",
    });
    let hidden = 0;
    for (const r of sourced) {
      const hide = !iso(r.hidden_at);
      await pb.collection(IDEAS).update(r.id, {
        source_org: "",
        source_thread: "",
        ...(hide
          ? {
              hidden_at: now.toISOString(),
              hold_reason: IDEA_HOLD_SOURCE_DELETED,
            }
          : {}),
      });
      if (hide) hidden++;
    }
    return { recounted, hidden };
  });
}

export type ListIdeasInput = { status?: IdeaStatus };

/**
 * The board (choice 2; `support:read`): visible, unmerged ideas of one status (default
 * Suggested), ranked by votes then newest. Viewers read too.
 */
export async function listIdeas(
  ctx: OrgContext,
  input: ListIdeasInput = {},
): Promise<IdeaCard[]> {
  assertOrgContext(ctx);
  requirePermission(ctx, "support", "read");
  assertId(ctx.orgId);
  const status = input?.status ?? "suggested";
  if (!isIdeaStatus(status)) throw new InvalidInput("unknown idea status");
  return withSuperuser(async (pb) => {
    const res = await pb.collection(IDEAS).getList(1, LIST_MAX, {
      filter: pb.filter(
        "status = {:status} && hidden_at = '' && merged_into = ''",
        { status },
      ),
      sort: "-votes,-created,id",
    });
    const mine = await pb.collection(VOTES).getFullList({
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      fields: "idea",
    });
    const voted = new Set(mine.map((v) => str(v.idea)));
    return res.items.map((r) => toCard(r, ctx.orgId, voted.has(r.id)));
  });
}

/**
 * Where a (possibly merged) idea lives now (choice 2; `support:read`): follows `merged_into`
 * to a listed idea. Junk, missing and hidden: NotFound.
 */
export async function resolveMergedIdea(
  ctx: OrgContext,
  id: unknown,
): Promise<string> {
  assertOrgContext(ctx);
  requirePermission(ctx, "support", "read");
  return withSuperuser(async (pb) => {
    let row = await loadIdea(pb, id);
    for (let hop = 0; hop < MERGE_HOPS && str(row.merged_into); hop++) {
      row = await loadIdea(pb, row.merged_into);
    }
    if (!isListed(row)) throw new NotFound("idea not found");
    return row.id;
  });
}

/**
 * One vote per site (choice 3; `support:write`: Owner/Admin/Editor, impersonation refused).
 * Votes when the site has not, removes the vote when it has. A unique violation means a
 * concurrent request already voted: the result is one vote. Returns the recounted total.
 */
export async function toggleIdeaVote(
  ctx: OrgContext,
  id: unknown,
): Promise<{ voted: boolean; votes: number }> {
  assertOrgContext(ctx);
  requirePermission(ctx, "support", "write");
  assertMemberWriter(ctx);
  assertId(ctx.orgId);
  return withSuperuser(async (pb) => {
    const idea = await loadIdea(pb, id);
    if (!isListed(idea)) throw new NotFound("idea not found");
    const existing = await orgVote(pb, ctx.orgId, idea.id);
    let voted: boolean;
    if (existing) {
      await pb
        .collection(VOTES)
        .delete(existing.id)
        .catch((err: unknown) => {
          if (!(err instanceof ClientResponseError && err.status === 404)) {
            throw err;
          }
        });
      voted = false;
    } else {
      try {
        await pb.collection(VOTES).create({
          organization: ctx.orgId,
          idea: idea.id,
          voted_by: ctx.actor,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      voted = true;
    }
    const votes = await recountVotes(pb, idea.id);
    await pb.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.idea_vote",
        organization: ctx.orgId,
        targetCollection: IDEAS,
        targetId: idea.id,
        meta: { voted },
      }),
    );
    return { voted, votes };
  });
}

// ---------------------------------------------------------------------------------------
// Staff (choice 4, `ideas_run`)

export type StaffIdeaRow = {
  id: string;
  title: string;
  description: string;
  status: IdeaStatus;
  votes: number;
  created: string;
  hiddenAt: string | null;
  holdReason: string | null;
  mergedInto: string | null;
  /** The suggesting business (staff only). */
  sourceOrg: string;
  sourceOrgName: string;
  sourceTicket: number | null;
};

export type StaffListIdeasInput = {
  status?: IdeaStatus;
  /** Default true: staff review held ideas here. */
  includeHidden?: boolean;
  includeMerged?: boolean;
};

/** Staff list (choice 4): hidden ideas included, merged ones on request, held first. */
export async function staffListIdeas(
  ctx: PlatformContext,
  input: StaffListIdeasInput = {},
): Promise<StaffIdeaRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "ideas_run");
  if (input.status !== undefined && !isIdeaStatus(input.status)) {
    throw new InvalidInput("unknown idea status");
  }
  return withSuperuser(async (pb) => {
    const parts: string[] = [];
    const params: Record<string, unknown> = {};
    if (input.status) {
      parts.push("status = {:status}");
      params.status = input.status;
    }
    if (input.includeHidden === false) parts.push("hidden_at = ''");
    if (!input.includeMerged) parts.push("merged_into = ''");
    const rows = await pb.collection(IDEAS).getFullList({
      ...(parts.length
        ? { filter: pb.filter(parts.join(" && "), params) }
        : {}),
      sort: "-votes,-created,id",
    });
    const orgIds = [...new Set(rows.map((r) => str(r.source_org)))].filter(
      (o) => ID_RE.test(o),
    );
    const threadIds = [
      ...new Set(rows.map((r) => str(r.source_thread))),
    ].filter((t) => ID_RE.test(t));
    const names = new Map<string, string>();
    for (const o of orgIds) {
      const org = await pb
        .collection("organizations")
        .getOne(o, { fields: "id,name" })
        .catch(() => null);
      names.set(o, str(org?.name));
    }
    const numbers = new Map<string, number>();
    for (const t of threadIds) {
      const th = await pb
        .collection(THREADS)
        .getOne(t, { fields: "id,number" })
        .catch(() => null);
      if (th && typeof th.number === "number") numbers.set(t, th.number);
    }
    const out = rows.map((r) => ({
      id: r.id,
      title: str(r.title),
      description: str(r.description),
      status: statusOf(r.status),
      votes: typeof r.votes === "number" ? r.votes : 0,
      created: str(r.created),
      hiddenAt: iso(r.hidden_at),
      holdReason: iso(r.hold_reason),
      mergedInto: iso(r.merged_into),
      sourceOrg: str(r.source_org),
      sourceOrgName: names.get(str(r.source_org)) ?? "",
      sourceTicket: numbers.get(str(r.source_thread)) ?? null,
    }));
    // Held for review first, so staff see what waits on them.
    return out.sort(
      (a, b) =>
        Number(b.holdReason === IDEA_HOLD_REVIEW && !!b.hiddenAt) -
        Number(a.holdReason === IDEA_HOLD_REVIEW && !!a.hiddenAt),
    );
  });
}

/** Every idea id whose suggestion tickets belong to `root`: itself and all merged into it. */
async function mergedFamily(
  pb: PocketBase,
  root: string,
): Promise<RecordModel[]> {
  const out: RecordModel[] = [];
  const seen = new Set<string>([root]);
  let frontier = [root];
  for (let hop = 0; hop < MERGE_HOPS && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      const rows = await pb.collection(IDEAS).getFullList({
        filter: pb.filter("merged_into = {:id}", { id }),
      });
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
        next.push(r.id);
      }
    }
    frontier = next;
  }
  return out;
}

export type StaffSetIdeaStatusResult = {
  from: IdeaStatus;
  to: IdeaStatus;
  /** Linked suggestion tickets moved to Resolved. */
  resolved: number;
  /** Voting orgs told it is built (Built only). */
  notified: number;
};

/**
 * Sets an idea's status (choice 4). On a change, every linked suggestion ticket (this idea's
 * and those merged into it) that is not Closed gets a public "Idea status" system line and moves
 * to Resolved. On Built, each voting org's members (every role `eligibleFor` lets through:
 * Owner, Admin and Editor; Viewers get no normal alerts) get a `cds.idea_built` bell row
 * "An idea you voted for is built: {title}" under the plain key `cds:idea:<id>`.
 */
export async function staffSetIdeaStatus(
  ctx: PlatformContext,
  input: { id: string; to: IdeaStatus },
  deps: IdeaDeps = {},
): Promise<StaffSetIdeaStatusResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "ideas_run");
  if (!isIdeaStatus(input?.to)) throw new InvalidInput("unknown idea status");
  const to = input.to;
  const now = nowOf(deps.clock);
  const done = await withSuperuser(async (pb) => {
    const idea = await loadIdea(pb, input.id);
    if (str(idea.merged_into)) {
      throw new InvalidInput(
        "this idea was merged; set the status on its target",
      );
    }
    const from = statusOf(idea.status);
    if (from === to) {
      return {
        from,
        to,
        resolved: 0,
        voters: [] as string[],
        title: "",
        names: new Map<string, string>(),
      };
    }
    const batch = pb.createBatch();
    batch.collection(IDEAS).update(idea.id, { status: to });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.idea_status",
        organization: null,
        targetCollection: IDEAS,
        targetId: idea.id,
        meta: { from, to },
      }),
    );
    await batch.send();

    let resolved = 0;
    const family = [idea, ...(await mergedFamily(pb, idea.id))];
    const label = `Idea status: ${STATUS_LABEL[to]}`;
    for (const member of family) {
      const threadId = str(member.source_thread);
      if (!ID_RE.test(threadId)) continue;
      try {
        const thread = await pb.collection(THREADS).getOne(threadId);
        if (str(thread.kind) !== "ticket" || thread.status === "closed")
          continue;
        const ratedAgent = await ratedAgentFor(pb, thread);
        const tb = pb.createBatch();
        const messageId = appendMessage(
          pb,
          tb,
          {
            orgId: str(thread.organization),
            thread,
            authorKind: "system",
            authorName: "CDS",
            body: "",
            visibility: "public",
            event: { kind: "idea_status", label },
          },
          now,
        );
        const r = applyTicketTransition(pb, tb, {
          thread,
          event: "staff_set",
          to: "resolved" as TicketStatus,
          actor: ctx,
          now: new Date(now.getTime() + 1),
          afterMessageId: messageId,
          ratedAgent,
        });
        await tb.send();
        if (r.to !== r.from) resolved++;
      } catch (err) {
        console.error(`[support] idea ticket move failed ${errName(err)}`);
      }
    }

    let voters: string[] = [];
    if (to === "built") {
      const votes = await pb.collection(VOTES).getFullList({
        filter: pb.filter("idea = {:idea}", { idea: idea.id }),
        fields: "organization",
      });
      voters = [...new Set(votes.map((v) => str(v.organization)))].filter((o) =>
        ID_RE.test(o),
      );
    }
    const names = new Map<string, string>();
    const open: string[] = [];
    for (const o of voters) {
      const org = await pb
        .collection("organizations")
        .getOne(o, { fields: "id,name,status,closed_reason" })
        .catch(() => null);
      // 12-REVIEW WR-A01: a closed site waiting for deletion is not told.
      if (!org || !isOpenOrg(org)) continue;
      open.push(o);
      names.set(o, str(org.name) || "your site");
    }
    voters = open;
    return { from, to, resolved, voters, title: str(idea.title), names };
  });

  let notified = 0;
  // Built only (voters is empty otherwise): one cds.idea_built bell row per voting org, under
  // its own plain key (12-REVIEW CR-A01), so it never replaces an unread CDS message.
  for (const orgId of done.voters) {
    try {
      await notifySupport(
        {
          orgId,
          as: ctx,
          type: "cds.idea_built",
          ideaId: input.id,
          itemTitle: done.title || "An idea",
          title: `An idea you voted for is built: ${done.title}`,
          href: "/hub/support?tab=ideas&status=built",
          businessName: done.names.get(orgId) ?? "your site",
        },
        {
          now,
          transport: deps.transport,
          push: deps.push,
          types: deps.types,
        },
      );
      notified++;
    } catch (err) {
      // The status is saved; a failed alert never undoes it.
      console.error(`[support] idea built alert failed ${errName(err)}`);
    }
  }
  return { from: done.from, to: done.to, resolved: done.resolved, notified };
}

export type StaffMergeIdeasResult = {
  /** Votes each idea had before the merge. */
  fromVotes: number;
  intoVotes: number;
  /** The target's votes after the merge. */
  total: number;
  /** Sites that voted for both (counted once). */
  both: number;
};

/**
 * Merges a duplicate into another idea (choice 4). Votes move with per-org dedupe (a site that
 * voted for both keeps one), `merged_into` is set (ideas already merged into `from` follow it),
 * and both counts are recounted.
 */
export async function staffMergeIdeas(
  ctx: PlatformContext,
  input: { from: string; into: string },
): Promise<StaffMergeIdeasResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "ideas_run");
  return withSuperuser(async (pb) => {
    const from = await loadIdea(pb, input?.from);
    const into = await loadIdea(pb, input?.into);
    if (from.id === into.id) {
      throw new InvalidInput("an idea cannot be merged into itself");
    }
    if (str(from.merged_into))
      throw new InvalidInput("that idea is already merged");
    if (str(into.merged_into)) {
      throw new InvalidInput(
        "the target idea was merged; merge into its target",
      );
    }
    const fromVotes = await countVotes(pb, from.id);
    const intoVotes = await countVotes(pb, into.id);
    const moving = await pb.collection(VOTES).getFullList({
      filter: pb.filter("idea = {:idea}", { idea: from.id }),
    });
    let both = 0;
    for (const v of moving) {
      const dup = await orgVote(pb, str(v.organization), into.id);
      if (dup) {
        both++;
        await pb.collection(VOTES).delete(v.id);
        continue;
      }
      try {
        await pb.collection(VOTES).update(v.id, { idea: into.id });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        both++;
        await pb.collection(VOTES).delete(v.id);
      }
    }
    const batch = pb.createBatch();
    batch.collection(IDEAS).update(from.id, { merged_into: into.id, votes: 0 });
    const followers = await pb.collection(IDEAS).getFullList({
      filter: pb.filter("merged_into = {:id}", { id: from.id }),
      fields: "id",
    });
    for (const f of followers) {
      batch.collection(IDEAS).update(f.id, { merged_into: into.id });
    }
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.idea_merged",
        organization: null,
        targetCollection: IDEAS,
        targetId: from.id,
        meta: { into: into.id, fromVotes, intoVotes, both },
      }),
    );
    await batch.send();
    await recountVotes(pb, from.id);
    const total = await recountVotes(pb, into.id);
    return { fromVotes, intoVotes, total, both };
  });
}

/** Hides an idea from the board (choice 4; the privacy safety valve). */
export async function staffHideIdea(
  ctx: PlatformContext,
  input: { id: string },
  deps: Pick<IdeaDeps, "clock"> = {},
): Promise<{ hidden: boolean }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "ideas_run");
  const now = nowOf(deps.clock);
  return withSuperuser(async (pb) => {
    const idea = await loadIdea(pb, input?.id);
    if (iso(idea.hidden_at) && str(idea.hold_reason) === IDEA_HOLD_STAFF) {
      return { hidden: false };
    }
    const batch = pb.createBatch();
    batch.collection(IDEAS).update(idea.id, {
      hidden_at: iso(idea.hidden_at) ?? now.toISOString(),
      hold_reason: IDEA_HOLD_STAFF,
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.idea_hidden",
        organization: null,
        targetCollection: IDEAS,
        targetId: idea.id,
        meta: {},
      }),
    );
    await batch.send();
    return { hidden: true };
  });
}

/** Shows a hidden or held idea on the board again (choice 4; also clears a review hold). */
export async function staffUnhideIdea(
  ctx: PlatformContext,
  input: { id: string },
): Promise<{ shown: boolean }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "ideas_run");
  return withSuperuser(async (pb) => {
    const idea = await loadIdea(pb, input?.id);
    if (!iso(idea.hidden_at)) return { shown: false };
    const batch = pb.createBatch();
    batch.collection(IDEAS).update(idea.id, { hidden_at: "", hold_reason: "" });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.idea_unhidden",
        organization: null,
        targetCollection: IDEAS,
        targetId: idea.id,
        meta: { held: str(idea.hold_reason) || null },
      }),
    );
    await batch.send();
    return { shown: true };
  });
}

/** Edits an idea's title and/or description (choice 4; e.g. to take a business name out). */
export async function staffEditIdea(
  ctx: PlatformContext,
  input: { id: string; title?: string; description?: string },
): Promise<{ changed: ("title" | "description")[] }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "ideas_run");
  const update: Record<string, string> = {};
  if (input?.title !== undefined) update.title = cleanTitle(input.title);
  if (input?.description !== undefined) {
    update.description = cleanDescription(input.description);
  }
  if (Object.keys(update).length === 0) {
    throw new InvalidInput("give a new title or description");
  }
  return withSuperuser(async (pb) => {
    const idea = await loadIdea(pb, input.id);
    const changed = (Object.keys(update) as ("title" | "description")[]).filter(
      (k) => str(idea[k]) !== update[k],
    );
    if (changed.length === 0) return { changed };
    const batch = pb.createBatch();
    batch.collection(IDEAS).update(idea.id, update);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.idea_edited",
        organization: null,
        targetCollection: IDEAS,
        targetId: idea.id,
        meta: { changed },
      }),
    );
    await batch.send();
    return { changed };
  });
}
