// Ticket ratings, tenant side (STAFF-21, D212, P13-P18; 13-16 choice 2). On a Resolved ticket
// an Owner, Admin, Editor or the filer taps thumbs up or down, optionally with a comment
// (≤ 500). One rating per ticket, changeable until Closed. Refused under impersonation
// (`support:write` is deny-listed, T-13-16-03) and on any other status. Rating never changes
// the ticket's status and never blocks closing.
//
// A rating that becomes `down` (new, or changed from up) mails `support.rating_down` to the
// staff alert address (CDS_STAFF_ALERT_EMAIL, else CDS_SUPPORT_EMAIL). Saving a comment on an
// existing down rating does not mail again. Mail failures are logged by class name, never
// thrown: the rating is already saved.
import { InvalidInput, NotFound } from "@cds/core";
import {
  RATING_COMMENT_MAX,
  canRate,
  isRatingChoice,
  parseTicketNumber,
  type RatingChoice,
} from "@cds/core/support";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { mintSystemContext, type OrgContext } from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress } from "../media/ops/alerts";
import { beginSupportAction } from "../rate-limit";
import { assertId, requirePermission } from "../repository";
import { errName, staffFirstName, THREADS } from "./shared";

/** Comment excerpt carried in the staff mail (choice 2). */
export const RATING_DOWN_EXCERPT_MAX = 300;

const RATING_MAIL_CTX = mintSystemContext({ job: "support-rating" });
const STAFF_ID_RE = /^[a-z0-9]{15}$/;

export type RateTicketInput = {
  number: unknown;
  rating: RatingChoice;
  /**
   * Optional comment. Omitted keeps the stored one; empty or null clears it; text is trimmed
   * and capped at 500.
   */
  comment?: string | null;
};

export type RateTicketDeps = {
  now?: Date;
  transport?: EmailTransport;
  send?: typeof sendEmail;
};

export type RateTicketResult = {
  number: number;
  rating: RatingChoice;
  comment: string | null;
  ratedAt: string;
  /** True when the stored rating changed (new, or up ↔ down). */
  changed: boolean;
  /** "sent" when the thumbs-down mail went out; "none" when no mail was due. */
  alert: "sent" | "skipped" | "failed" | "none";
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function cleanComment(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw new InvalidInput("comment must be text");
  const t = v.trim();
  if (t.length > RATING_COMMENT_MAX) {
    throw new InvalidInput(
      `comment must be at most ${RATING_COMMENT_MAX} characters`,
    );
  }
  return t === "" ? null : t;
}

/** One of this org's tickets by number; another org's number is the same NotFound. */
async function loadOrgTicket(
  pb: PocketBase,
  orgId: string,
  raw: unknown,
): Promise<RecordModel> {
  const n = parseTicketNumber(raw);
  assertId(orgId);
  try {
    return await pb.collection(THREADS).getFirstListItem(
      pb.filter("number = {:n} && organization = {:org} && kind = 'ticket'", {
        n,
        org: orgId,
      }),
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound("ticket not found");
    }
    throw err;
  }
}

function validNow(now: Date | undefined): Date {
  const at = now ?? new Date();
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  return at;
}

/** Rate one of this org's tickets (support:write). See the header for the rules. */
export async function rateTicket(
  ctx: OrgContext,
  input: RateTicketInput,
  deps: RateTicketDeps = {},
): Promise<RateTicketResult> {
  requirePermission(ctx, "support", "write");
  if (!isRatingChoice(input?.rating)) {
    throw new InvalidInput("rating must be up or down");
  }
  const rating = input.rating;
  const comment = cleanComment(input.comment);
  const now = validNow(deps.now);

  const done = await withSuperuser(async (pb) => {
    const thread = await loadOrgTicket(pb, ctx.orgId, input.number);
    const status = str(thread.status);
    if (status === "closed") {
      throw new InvalidInput("This ticket is closed, so ratings are finished.");
    }
    if (
      !canRate({
        status,
        role: ctx.role,
        isFiler: str(thread.opened_by) === ctx.actor,
        impersonated: Boolean(ctx.impersonator),
      })
    ) {
      throw new InvalidInput("Only a resolved ticket can be rated.");
    }
    beginSupportAction("message", { orgId: ctx.orgId, actorId: ctx.actor });
    const before = str(thread.rating);
    const changed = before !== rating;
    const storedComment =
      comment === undefined ? str(thread.rating_comment) || null : comment;
    const at = now.toISOString();
    const update: Record<string, unknown> = {
      rating,
      rating_comment: storedComment ?? "",
      rated_at: at,
      rated_by: ctx.actor,
    };
    // A fresh thumbs-down needs a fresh follow-up (P13-P32).
    if (changed && rating === "down") update.rating_followed_at = "";
    const batch = pb.createBatch();
    batch.collection(THREADS).update(thread.id, update);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.rated",
        organization: ctx.orgId,
        targetCollection: THREADS,
        targetId: thread.id,
        // Never the comment text.
        meta: { number: Number(thread.number) || 0, rating },
      }),
    );
    await batch.send();
    const mail =
      changed && rating === "down"
        ? await ratingDownData(pb, thread, storedComment)
        : null;
    return {
      number: Number(thread.number) || 0,
      comment: storedComment,
      ratedAt: at,
      changed,
      mail,
    };
  });

  let alert: RateTicketResult["alert"] = "none";
  if (done.mail) alert = await sendRatingDown(done.mail, deps);
  return {
    number: done.number,
    rating,
    comment: done.comment,
    ratedAt: done.ratedAt,
    changed: done.changed,
    alert,
  };
}

type RatingDownMail = {
  ticketNumber: number;
  business: string;
  agent: string;
  subject: string;
  comment: string | null;
  resolvedAt: Date;
  href: string;
};

async function ratingDownData(
  pb: PocketBase,
  thread: RecordModel,
  comment: string | null,
): Promise<RatingDownMail> {
  const number = Number(thread.number) || 0;
  const org = await pb
    .collection("organizations")
    .getOne(str(thread.organization), { fields: "id,name" })
    .catch(() => null);
  const agentId = str(thread.rated_agent);
  const agent = STAFF_ID_RE.test(agentId)
    ? await staffFirstName(pb, agentId)
    : "";
  const resolvedRaw = str(thread.resolved_at).replace(" ", "T");
  const resolved = new Date(resolvedRaw);
  return {
    ticketNumber: number,
    business: str(org?.name) || "A site",
    agent,
    subject: str(thread.subject),
    comment: comment ? comment.slice(0, RATING_DOWN_EXCERPT_MAX) : null,
    resolvedAt: Number.isNaN(resolved.getTime()) ? new Date() : resolved,
    href: platformUrl(`/staff/tickets/${number}`),
  };
}

async function sendRatingDown(
  data: RatingDownMail,
  deps: RateTicketDeps,
): Promise<"sent" | "skipped" | "failed"> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn("[support] rating_down not sent: no staff alert address");
    return "skipped";
  }
  try {
    const r = await (deps.send ?? sendEmail)(
      { kind: "cds", ctx: RATING_MAIL_CTX, noReply: true },
      "support.rating_down",
      to,
      data,
      { transport: deps.transport },
    );
    return r.status === "sent" ? "sent" : "skipped";
  } catch (err) {
    console.error(`[support] rating_down failed ${errName(err)}`);
    return "failed";
  }
}

/** What the hub rating card needs for one ticket (13-42): never `rated_by` or the agent. */
export type TicketRatingView = {
  threadId: string;
  number: number;
  status: string;
  rating: RatingChoice | null;
  comment: string | null;
  ratedAt: string | null;
  /** Owner, Admin, Editor or the filer: may rate while Resolved (impersonation aside). */
  isRater: boolean;
  /** `canRate` right now: Resolved, a rater, and not impersonated. */
  canRate: boolean;
};

/**
 * The stored rating of one of this org's tickets and whether this person may rate it
 * (`support:read`; 13-42). Read-only, so impersonating staff can see it; another org's
 * number is NotFound.
 */
export async function ticketRatingView(
  ctx: OrgContext,
  number: unknown,
): Promise<TicketRatingView> {
  requirePermission(ctx, "support", "read");
  return withSuperuser(async (pb) => {
    const thread = await loadOrgTicket(pb, ctx.orgId, number);
    const status = str(thread.status);
    const isFiler = str(thread.opened_by) === ctx.actor;
    const stored = str(thread.rating);
    return {
      threadId: thread.id,
      number: Number(thread.number) || 0,
      status,
      rating: isRatingChoice(stored) ? stored : null,
      comment: str(thread.rating_comment) || null,
      ratedAt: str(thread.rated_at) || null,
      isRater: canRate({
        status: "resolved",
        role: ctx.role,
        isFiler,
        impersonated: false,
      }),
      canRate: canRate({
        status,
        role: ctx.role,
        isFiler,
        impersonated: Boolean(ctx.impersonator),
      }),
    };
  });
}
