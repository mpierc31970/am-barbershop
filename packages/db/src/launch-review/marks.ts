// packages/db/src/launch-review/marks.ts (P14, DOM-10).
// Owner: 14-33 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Launch review marks (D172; 14-33 choices 1-2). Every write is the Owner's, never under
// impersonation (`launch_review:write` is deny-listed, T-14-33-01), never a system job. The
// organization always comes from the context (Invariant 1); a page id from another org is
// NotFound (no oracle). One mark per (organization, kind, page), upserted under the org lock
// in one batch with its audit row (`launch_review.marked`, who and when; T-14-33-04).
// `page_version` is the page's current published_at, so a later publish resets the page's
// status by computation (facts.ts), never by mutation.
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import {
  assertOrgContext,
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../context";
import { verifyReviewToken } from "../dns/preview-links";
import { requirePermission } from "../repository";
import { loadReviewFacts, upsertMark, type ReviewPageFact } from "./facts";

export type ReviewMarkStatus = "looks_good" | "needs_change";

const ID_RE = /^[a-z0-9]{15}$/;
const POLICY_IDS = new Set(["privacy", "terms"]);
const REVIEW_STAGES = new Set(["ready_for_review", "being_built"]);

/** Owner only, not impersonated, not a system job (choice 1). */
export function assertReviewWriter(ctx: OrgContext): void {
  requirePermission(ctx, "launch_review", "write");
  if (ctx.systemJob || !ctx.actor) {
    throw new Forbidden("only the site owner can review the launch");
  }
}

function mapped<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound();
    }
    throw err;
  });
}

function pageOf(
  facts: { pages: ReviewPageFact[] },
  pageId: unknown,
): ReviewPageFact {
  if (
    typeof pageId !== "string" ||
    !(ID_RE.test(pageId) || POLICY_IDS.has(pageId))
  ) {
    throw new NotFound();
  }
  const page = facts.pages.find((p) => p.id === pageId);
  if (!page) throw new NotFound();
  return page;
}

/** The review page (P14-P14 set) for `pageId` in the context's own org, or NotFound. */
export async function reviewPageFor(
  ctx: OrgContext,
  pageId: unknown,
): Promise<ReviewPageFact> {
  assertOrgContext(ctx);
  const facts = await mapped(
    withSuperuser((pb) => loadReviewFacts(pb, ctx.orgId)),
  );
  return pageOf(facts, pageId);
}

/**
 * Mark one review page Looks good or Needs a change (choice 1). A later publish of the page
 * makes the mark stale (computed). `noteTicket` records the P12 change ticket a Needs-a-change
 * note was sent as; without it an existing ticket number is kept; Looks good clears it.
 */
export async function markPage(
  ctx: OrgContext,
  pageId: string,
  status: ReviewMarkStatus,
  opts: { noteTicket?: number; now?: Date } = {},
): Promise<{ page: string; status: ReviewMarkStatus; at: string }> {
  assertReviewWriter(ctx);
  if (status !== "looks_good" && status !== "needs_change") {
    throw new InvalidInput("status must be looks_good or needs_change");
  }
  const note = opts.noteTicket;
  if (
    note !== undefined &&
    (!Number.isInteger(note) || note <= 0 || note > 1e9)
  ) {
    throw new InvalidInput("noteTicket must be a ticket number");
  }
  const now = opts.now ?? new Date();
  return mapped(
    withOrgLock(ctx.orgId, () =>
      withSuperuser(async (pb) => {
        const facts = await loadReviewFacts(pb, ctx.orgId);
        const page = pageOf(facts, pageId);
        const r = await upsertMark(pb, {
          orgId: ctx.orgId,
          kind: "page",
          page: page.id,
          status,
          version: page.version,
          by: ctx.actor,
          at: now,
          ...(status === "looks_good"
            ? { noteTicket: 0 }
            : note !== undefined
              ? { noteTicket: note }
              : {}),
          audit: ctx,
        });
        return { page: page.id, status, at: r.at };
      }),
    ),
  );
}

/**
 * The Owner confirms the key facts screen (item 3). An unconfirmed email address blocks it
 * (D173, UI-SPEC FACTS-EMAIL).
 */
export async function markKeyFacts(
  ctx: OrgContext,
  opts: { now?: Date } = {},
): Promise<{ at: string }> {
  assertReviewWriter(ctx);
  const now = opts.now ?? new Date();
  return mapped(
    withOrgLock(ctx.orgId, () =>
      withSuperuser(async (pb) => {
        const facts = await loadReviewFacts(pb, ctx.orgId);
        if (!facts.emailConfirmed) {
          throw new InvalidInput(
            facts.unconfirmedEmail
              ? P14_COPY.FACTS_EMAIL({ email: facts.unconfirmedEmail })
              : "Add and confirm your email address first.",
          );
        }
        const r = await upsertMark(pb, {
          orgId: ctx.orgId,
          kind: "key_facts",
          status: "done",
          by: ctx.actor,
          at: now,
          audit: ctx,
        });
        return { at: r.at };
      }),
    ),
  );
}

/** "Checked on my phone" (item 4), from the phone or ticked on desktop. */
export async function markPhoneCheck(
  ctx: OrgContext,
  opts: { now?: Date } = {},
): Promise<{ at: string }> {
  assertReviewWriter(ctx);
  const now = opts.now ?? new Date();
  return mapped(
    withOrgLock(ctx.orgId, () =>
      withSuperuser(async (pb) => {
        const r = await upsertMark(pb, {
          orgId: ctx.orgId,
          kind: "phone_check",
          status: "done",
          by: ctx.actor,
          at: now,
          audit: ctx,
        });
        return { at: r.at };
      }),
    ),
  );
}

/**
 * System (14-35's form path, P14-P26): a test submission landed. Ticks item 5 only when the
 * submission is this org's and is marked `is_test`; anything else is a silent no-op (false).
 */
export async function recordTestFormSubmission(
  orgId: string,
  submissionId: string,
  opts: { now?: Date } = {},
): Promise<boolean> {
  if (
    typeof orgId !== "string" ||
    !ID_RE.test(orgId) ||
    typeof submissionId !== "string" ||
    !ID_RE.test(submissionId)
  ) {
    return false;
  }
  const now = opts.now ?? new Date();
  return withOrgLock(orgId, () =>
    withSuperuser(async (pb) => {
      const sub = await pb
        .collection("form_submissions")
        .getOne(submissionId, { fields: "id,organization,is_test" })
        .catch(() => null);
      if (!sub || sub.organization !== orgId || sub.is_test !== true) {
        return false;
      }
      await upsertMark(pb, {
        orgId,
        kind: "test_form",
        status: "done",
        by: "",
        at: now,
        audit: mintSystemContext({ job: "launch-review" }),
        auditMeta: { kind: "test_form", status: "done" },
      });
      return true;
    }),
  );
}

/**
 * Choice 2 (T-14-33-02): the Owner context behind a valid `review.` token. The token's MAC and
 * 60-minute expiry are checked first; then the member must still be an `owner` membership of
 * an active org whose stage is ready_for_review or being_built, and not a staff user. Every
 * other case is null. The context is minted like a sign-in (no impersonator); the token's
 * member id is the user id. Used only by the preview-host review routes (14-35).
 */
export async function reviewContextForToken(
  token: unknown,
  opts: { ip?: string; now?: Date | number } = {},
): Promise<OrgContext | null> {
  const v = verifyReviewToken(token, opts.now ?? Date.now());
  if (v.status !== "valid") return null;
  try {
    return await withSuperuser(async (pb) => {
      const org = await pb
        .collection("organizations")
        .getOne(v.orgId, { fields: "id,status,stage" })
        .catch(() => null);
      if (!org || org.status !== "active") return null;
      if (!REVIEW_STAGES.has(String(org.stage))) return null;
      const user = await pb
        .collection("users")
        .getOne(v.memberId, { fields: "id,staff_role" })
        .catch(() => null);
      if (!user || user.staff_role) return null;
      const m = await pb
        .collection("memberships")
        .getList(1, 1, {
          filter: pb.filter(
            "user = {:user} && organization = {:org} && role = 'owner'",
            { user: v.memberId, org: v.orgId },
          ),
          fields: "id,role,addon_grants",
          skipTotal: true,
        })
        .then((r) => r.items[0] ?? null);
      if (!m) return null;
      const raw: unknown = m.addon_grants;
      const grants = Array.isArray(raw)
        ? raw.filter((g): g is string => typeof g === "string")
        : [];
      return mintOrgContext({
        orgId: v.orgId,
        actor: v.memberId,
        role: "owner",
        grants,
        ip: (opts.ip ?? "review-token").slice(0, 64),
      });
    });
  } catch (err) {
    console.error(
      `[launch-review] review token context failed: ${err instanceof Error ? err.constructor.name : "Error"}`,
    );
    return null;
  }
}
