// packages/db/src/launch-review/review.ts (P14, DOM-10).
// Owner: 14-33 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The facts /hub/review (14-34) and review mode (14-35) render, plus the two owner actions
// that leave the review: Needs a change (a P12 change ticket targeting the page, choice 4) and
// Ready to launch (choice 5: all six D172 items done AND the domain move prepared; records
// `submitted`, emails the owner `review.sent` and CDS `staff.domain_alert` launch_requested).
// Reads need launch_review:read (Owner, Admin, Editor); writes are the Owner's, never under
// impersonation. The org is always the context's own (Invariant 1, P14-P34).
import { InvalidInput, NotFound } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { mintSystemContext, type OrgContext } from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress } from "../media/ops/alerts";
import { LAUNCH_REVIEW_ITEMS } from "../org-stage";
import { requirePermission } from "../repository";
import { fileTicket, type TicketDeps } from "../support/threads";
import {
  loadReviewFacts,
  resubmitNeededOf,
  upsertMark,
  type ReviewFacts,
  type ReviewPageStatus,
} from "./facts";
import { assertReviewWriter, markPage, reviewPageFor } from "./marks";

export const LAUNCH_REVIEW_TOTAL = 6;
const NOTE_MIN = 10;
const NOTE_MAX = 2000;

export type ReviewPage = {
  id: string;
  title: string;
  path: string;
  status: ReviewPageStatus;
};

export type ReviewItem = {
  id: string;
  label: string;
  done: boolean;
  /** When the item was ticked (key facts, phone check, test form), else null. */
  at: string | null;
  /**
   * Item counts for the sub-line: pages_reviewed = pages Looks good of all review pages;
   * changes_sent = requests sent of Needs-a-change pages; no_open_requests = open change
   * tickets (of = null). Null for the other items.
   */
  count: number | null;
  of: number | null;
};

export type LaunchReviewView = {
  items: ReviewItem[];
  done: number;
  total: 6;
  pages: ReviewPage[];
  domainReady: boolean;
  domain: string | null;
  submittedAt: string | null;
  /** Titles of pages published again after the review was sent (RESUBMIT). */
  resubmitNeeded: string[];
  hasForm: boolean;
  emailConfirmed: boolean;
  /** An unconfirmed address for FACTS-EMAIL, or "". */
  unconfirmedEmail: string;
  /** The stage is ready_for_review. */
  available: boolean;
  /** The caller may act (Owner, not impersonated). */
  canAct: boolean;
};

function mapped<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound();
    }
    throw err;
  });
}

function facts(pb: PocketBase | null, orgId: string): Promise<ReviewFacts> {
  return mapped(
    pb
      ? loadReviewFacts(pb, orgId)
      : withSuperuser((c) => loadReviewFacts(c, orgId)),
  );
}

function pagesOf(f: ReviewFacts): ReviewPage[] {
  return f.pages.map((p) => ({
    id: p.id,
    title: p.title,
    path: p.path,
    status: p.status,
  }));
}

function resubmitOf(f: ReviewFacts): string[] {
  return resubmitNeededOf(f);
}

/** The review pages and their computed status (P14-P14). */
export async function reviewPages(ctx: OrgContext): Promise<ReviewPage[]> {
  requirePermission(ctx, "launch_review", "read");
  return pagesOf(await facts(null, ctx.orgId));
}

function canAct(ctx: OrgContext): boolean {
  try {
    assertReviewWriter(ctx);
    return true;
  } catch {
    return false;
  }
}

/** Everything /hub/review renders (launch_review:read). */
export async function launchReviewView(
  ctx: OrgContext,
): Promise<LaunchReviewView> {
  requirePermission(ctx, "launch_review", "read");
  const f = await facts(null, ctx.orgId);
  const looked = f.pages.filter((p) => p.status === "looks_good").length;
  const asked = f.pages.filter((p) => p.status === "needs_change");
  const at: Record<string, string | null> = {
    key_facts: f.keyFactsAt,
    phone_check: f.phoneCheckAt,
    test_form: f.testFormAt,
  };
  const counts: Record<string, [number, number | null]> = {
    pages_reviewed: [looked, f.pages.length],
    changes_sent: [asked.filter((p) => p.noteTicket > 0).length, asked.length],
    no_open_requests: [f.openChangeRequests, null],
  };
  const items: ReviewItem[] = LAUNCH_REVIEW_ITEMS.map((i) => ({
    id: i.id,
    label: i.label,
    done: f.done.has(i.id),
    at: at[i.id] ?? null,
    count: counts[i.id]?.[0] ?? null,
    of: counts[i.id]?.[1] ?? null,
  }));
  return {
    items,
    done: items.filter((i) => i.done).length,
    total: LAUNCH_REVIEW_TOTAL,
    pages: pagesOf(f),
    domainReady: f.move?.status === "prepared",
    domain: f.move?.toHost || null,
    submittedAt: f.submittedAt,
    resubmitNeeded: resubmitOf(f),
    hasForm: f.hasForm,
    emailConfirmed: f.emailConfirmed,
    unconfirmedEmail: f.unconfirmedEmail,
    available: f.stage === "ready_for_review",
    canAct: canAct(ctx),
  };
}

/**
 * Needs a change (choice 4): a 10-2000 character note becomes a P12 change ticket targeting
 * the page (`page:<id>`; a policy page targets the whole site), then the page is marked
 * Needs a change with the ticket number. Owner only.
 */
export async function requestPageChange(
  ctx: OrgContext,
  pageId: string,
  note: string,
  deps: TicketDeps = {},
): Promise<{ ticketNumber: number }> {
  assertReviewWriter(ctx);
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length < NOTE_MIN) throw new InvalidInput(P14_COPY.NOTE_SHORT);
  if (text.length > NOTE_MAX) {
    throw new InvalidInput(`Keep your note under ${NOTE_MAX} characters.`);
  }
  const page = await reviewPageFor(ctx, pageId);
  const ticket = await fileTicket(
    ctx,
    {
      type: "change",
      subject: `Change on ${page.title}`.slice(0, 120),
      body: text,
      ...(page.policy ? {} : { target: `page:${page.id}` }),
    },
    deps,
  );
  await markPage(ctx, page.id, "needs_change", { noteTicket: ticket.number });
  return { ticketNumber: ticket.number };
}

/** Thrown when Ready to launch is pressed before the domain move is prepared. */
export class DomainNotReady extends InvalidInput {
  override readonly code: string = "domain_not_ready";
  constructor() {
    super(P14_COPY.DOMAIN_NOT_READY);
  }
}

export type SubmitDeps = { now?: Date; transport?: EmailTransport };

async function ownerEmails(pb: PocketBase, orgId: string): Promise<string[]> {
  const rows = await pb.collection("memberships").getFullList({
    filter: pb.filter("organization = {:org} && role = 'owner'", {
      org: orgId,
    }),
    expand: "user",
    fields: "expand.user.email",
  });
  const out = new Set<string>();
  for (const r of rows) {
    const e = (r.expand?.user as { email?: unknown } | undefined)?.email;
    if (typeof e === "string" && e !== "") out.add(e);
  }
  return [...out];
}

function errName(err: unknown): string {
  return err instanceof Error ? err.constructor.name : "Error";
}

/**
 * Ready to launch (choice 5, D26, D172): the review must be open (ready_for_review), all six
 * items done (else InvalidInput "Finish N more items above.") and the launch move prepared
 * (else DomainNotReady). Records the `submitted` mark (a resubmission moves its time) with a
 * `launch_review.submitted` audit row, then emails the owner `review.sent` and CDS
 * `staff.domain_alert` (launch_requested). Mail failures are logged by class only.
 */
export async function submitLaunchReview(
  ctx: OrgContext,
  deps: SubmitDeps = {},
): Promise<{ submittedAt: string }> {
  assertReviewWriter(ctx);
  const now = deps.now ?? new Date();
  const { at, f, business } = await mapped(
    withOrgLock(ctx.orgId, () =>
      withSuperuser(async (pb) => {
        const f = await loadReviewFacts(pb, ctx.orgId);
        if (f.stage !== "ready_for_review") {
          throw new InvalidInput("Your site isn't ready for review yet.");
        }
        const missing = LAUNCH_REVIEW_TOTAL - f.done.size;
        if (missing > 0) {
          throw new InvalidInput(
            `Finish ${missing} more ${missing === 1 ? "item" : "items"} above.`,
          );
        }
        if (!f.move || f.move.status !== "prepared") throw new DomainNotReady();
        const org = await pb
          .collection("organizations")
          .getOne(ctx.orgId, { fields: "id,name" });
        const r = await upsertMark(pb, {
          orgId: ctx.orgId,
          kind: "submitted",
          status: "done",
          by: ctx.actor,
          at: now,
          audit: ctx,
          auditAction: "launch_review.submitted",
          auditMeta: { move: f.move.code, pages: f.pages.length },
        });
        return {
          at: r.at,
          f,
          business: typeof org.name === "string" ? org.name : "",
        };
      }),
    ),
  );

  const sys = mintSystemContext({ job: "launch-review" });
  const mail = deps.transport ? { transport: deps.transport } : {};
  try {
    const to = await withSuperuser((pb) => ownerEmails(pb, ctx.orgId));
    for (const addr of to) {
      await sendEmail(
        { kind: "cds", ctx: sys },
        "review.sent",
        addr,
        {},
        {
          ...mail,
          concernsOrg: ctx.orgId,
        },
      );
    }
  } catch (err) {
    console.error(`[launch-review] review.sent not sent: ${errName(err)}`);
  }
  const staffTo = staffAlertAddress();
  if (!staffTo) {
    console.warn(
      "[launch-review] staff alert not sent: no staff alert address",
    );
  } else {
    try {
      await sendEmail(
        { kind: "cds", ctx: sys },
        "staff.domain_alert",
        staffTo,
        {
          kind: "launch_requested",
          business,
          orgId: ctx.orgId,
          domain: f.move?.toHost ?? "",
          ...(f.move ? { moveCode: f.move.code } : {}),
          href: platformUrl("/staff/pipeline?tab=launch"),
        },
        { ...mail, concernsOrg: ctx.orgId },
      );
    } catch (err) {
      console.error(`[launch-review] staff alert not sent: ${errName(err)}`);
    }
  }
  return { submittedAt: at };
}
