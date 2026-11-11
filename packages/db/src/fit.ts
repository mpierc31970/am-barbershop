// Fit check at Submit and the staff fit review (ONB-12, D215; CONTEXT A1-Q5; PD-23).
//
// FitChecker is a port, like ContentScanner (content/ports.ts). The stand-in here is
// keyword-only: GO-LIVE P6 "Anthropic" row, where an AI review swaps in behind the same
// interface. Keyword lists are never duplicated: they come from AUP_CATEGORIES in
// @cds/core/onboarding (the one module the /start FAQ box also reads), and the
// reviewed-first business-type flag comes from findBusinessType.
//   - a never-hosted keyword       -> blocked (no org is created; D215)
//   - a reviewed-first keyword, or a business type with aup "review" -> review (stage fit_review)
//   - otherwise                    -> clear
// Matching is whole-word and case-insensitive over the name, description and the "other"
// business type text.
//
// R2-CR-01: an approve is bound to the case staff read. describeFitCase returns a
// fingerprint of every screened field, the verdict and the reasons; approveFit refuses when
// the case differs now, and refuses a "blocked" verdict unless staff override it explicitly.
//
// Staff review (super_admin, "fit_review" feature): approve moves the org back to intake
// (or ready_for_build when the intake was already sent) and re-activates a held org;
// decline sets organizations.status = "held" and keeps stage fit_review. Both write the
// state change and an audit row (with the reason) in one PB batch, then email the owner's
// confirmed default route, else the owner's sign-in address (A-WR-08). A send failure is
// logged; the decision stands (T-06-40). The read, decision and write run under the org
// lock (A-WR-07); an approve to intake re-checks submitted_at afterwards, because the
// fit:review CLI is a separate process from the web app's Send.
//
// CDS_FIT_CHECKER selects the implementation: unset or "keyword" gives the stand-in; any
// other value throws, because no other implementation exists yet (fail loudly).
import { createHash } from "node:crypto";
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { AUP_CATEGORIES, findBusinessType } from "@cds/core/onboarding";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody, type AuditEvent } from "./audit";
import { withSuperuser } from "./client";
import { withOrgLock } from "./content/lock";
import {
  assertPlatformContext,
  assertSystemContext,
  type PlatformContext,
  type SystemContext,
} from "./context";
import { platformUrl } from "./email/env";
import { billingAccountByOrg } from "./payments/accounts";
import { invoiceMirrorsOf } from "./payments/invoices";
import { sendEmail } from "./email/send";
import type { EmailTransport } from "./email/transport";

export type FitVerdict = "clear" | "review" | "blocked";

export type FitInput = {
  businessType: string;
  businessTypeOther: string;
  name: string;
  description: string;
};

export type FitResult = {
  verdict: FitVerdict;
  category?: string;
  reasons: string[];
};

export interface FitChecker {
  check(input: FitInput): Promise<FitResult>;
}

const MAX_REASONS = 10;
const REASON_MAX = 500;
const ID_RE = /^[a-z0-9]{1,64}$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeWord(term: string): RegExp {
  const body = term.trim().split(/\s+/).map(escapeRe).join("\\s+");
  return new RegExp(`(^|[^a-z0-9_])${body}(?=$|[^a-z0-9_])`, "i");
}

const COMPILED = AUP_CATEGORIES.map((c) => ({
  name: c.name,
  verdict: c.verdict,
  terms: c.keywords.map((k) => [k, wholeWord(k)] as const),
}));

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function matchesIn(
  haystacks: string[],
  verdict: "never" | "review",
): { category: string; terms: string[] }[] {
  const out: { category: string; terms: string[] }[] = [];
  for (const c of COMPILED) {
    if (c.verdict !== verdict) continue;
    const terms = c.terms
      .filter(([, re]) => haystacks.some((h) => re.test(h)))
      .map(([t]) => t);
    if (terms.length > 0) out.push({ category: c.name, terms });
  }
  return out;
}

function reasonsOf(hits: { terms: string[] }[]): string[] {
  return hits.flatMap((h) => h.terms.map((t) => `keyword: ${t}`));
}

export const keywordFitChecker: FitChecker = {
  async check(input: FitInput): Promise<FitResult> {
    const haystacks = [
      str(input?.name),
      str(input?.description),
      str(input?.businessTypeOther),
    ].filter((h) => h !== "");

    const never = matchesIn(haystacks, "never");
    if (never.length > 0) {
      return {
        verdict: "blocked",
        category: never[0]!.category,
        reasons: reasonsOf(never).slice(0, MAX_REASONS),
      };
    }

    const review = matchesIn(haystacks, "review");
    const reasons: string[] = [];
    const type = findBusinessType(input?.businessType);
    if (type?.aup === "review") {
      // The type id is in the reason, so a switch to another reviewed-first type is a new
      // reason that staff have not approved (A-CR-01 re-screen).
      reasons.push(`business type: ${type.id}`);
    }
    reasons.push(...reasonsOf(review));
    if (reasons.length > 0) {
      const out: FitResult = {
        verdict: "review",
        reasons: reasons.slice(0, MAX_REASONS),
      };
      if (review[0]) out.category = review[0].category;
      return out;
    }
    return { verdict: "clear", reasons: [] };
  },
};

export function getFitChecker(): FitChecker {
  const v = process.env.CDS_FIT_CHECKER;
  if (v === undefined || v === "" || v === "keyword") return keywordFitChecker;
  throw new Error(
    `CDS_FIT_CHECKER="${v}" has no implementation yet (unset it to use the keyword stand-in)`,
  );
}

// ---------------------------------------------------------------- re-screen after Submit

// A-CR-01 / B-CR-01: everything the check reads at Submit stays editable afterwards (the
// profile and the org name), so the check runs again whenever one of these keys is saved
// and again at Send to CDS. A non-clear verdict moves the org to fit_review (a blocked one
// too: the org exists by now, so staff decide through fit:review) unless every reason was
// already approved by staff (the last fit.approve audit row records the reasons it cleared).

/** Profile keys (plus org_name) whose change re-runs the fit check. */
export const FIT_SCREENED_KEYS: readonly string[] = Object.freeze([
  "org_name",
  "business_type",
  "business_type_other",
  "tagline",
  "headline",
  "description",
  "about",
  "mission",
]);

/** The public text fields screened as the "description". */
const SCREENED_TEXT = [
  "tagline",
  "headline",
  "description",
  "about",
  "mission",
];

/**
 * Onboarding stages the re-screen watches ("" is not in setup). fit_review is watched too
 * (R2-CR-01): an edit while held records a fit.hold row for any reason staff have not seen,
 * and an approve is bound to the case staff reviewed (the fingerprint below).
 */
const RESCREEN_STAGES: readonly string[] = [
  "intake",
  "ready_for_build",
  "fit_review",
];

/** 13-52: true while a profile save re-runs the fit screen (onboarding stages only). */
export function fitRescreens(stage: string): boolean {
  return RESCREEN_STAGES.includes(stage);
}

/** Every screened field, labelled, as staff see it in the fit case (R2-CR-01). */
export function screenedFields(
  name: string,
  profile: Record<string, unknown> | null | undefined,
): { field: string; text: string }[] {
  const all: [string, string][] = [
    ["org_name", name],
    ["business_type", str(profile?.business_type)],
    ["business_type_other", str(profile?.business_type_other)],
    ...SCREENED_TEXT.map((k): [string, string] => [k, str(profile?.[k])]),
  ];
  return all
    .filter(([, t]) => t.trim() !== "")
    .map(([field, text]) => ({ field, text }));
}

/** A fingerprint of what staff reviewed: every screened field, the verdict and the reasons. */
export function fitFingerprint(
  fields: { field: string; text: string }[],
  verdict: FitVerdict,
  reasons: string[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ fields, verdict, reasons: [...reasons].sort() }))
    .digest("hex");
}

/** The checker input for an existing org: its name, business type and public text. */
export function orgFitInput(
  name: string,
  profile: Record<string, unknown> | null | undefined,
): FitInput {
  return {
    businessType: str(profile?.business_type),
    businessTypeOther: str(profile?.business_type_other),
    name,
    description: SCREENED_TEXT.map((k) => str(profile?.[k]))
      .filter((t) => t.trim() !== "")
      .join("\n"),
  };
}

/** The reasons on the org's latest audit row of this fit action ([] when none). */
async function latestFitReasons(
  pb: PocketBase,
  orgId: string,
  action: "fit.approve" | "fit.hold",
): Promise<Set<string>> {
  const list = await pb.collection("audit_log").getList(1, 1, {
    filter: pb.filter("organization = {:org} && action = {:action}", {
      org: orgId,
      action,
    }),
    sort: "-created,-id",
    fields: "meta",
  });
  const meta: unknown = list.items[0]?.meta;
  const reasons =
    typeof meta === "object" &&
    meta !== null &&
    Array.isArray((meta as { reasons?: unknown }).reasons)
      ? ((meta as { reasons: unknown[] }).reasons as unknown[])
      : [];
  return new Set(reasons.filter((r): r is string => typeof r === "string"));
}

/** The reasons staff cleared in the org's latest fit.approve row ([] when never approved). */
function approvedReasons(pb: PocketBase, orgId: string): Promise<Set<string>> {
  return latestFitReasons(pb, orgId, "fit.approve");
}

/**
 * Re-run the fit check for an org past Submit, in the caller's client (under its org lock).
 * Returns the result when the org must be held for review, else null.
 */
export async function rescreenFit(
  pb: PocketBase,
  orgId: string,
  stage: string,
  input: FitInput,
  checker: FitChecker = getFitChecker(),
): Promise<FitResult | null> {
  if (!RESCREEN_STAGES.includes(stage)) return null;
  const fit = await checker.check(input);
  if (fit.verdict === "clear") return null;
  const known = await approvedReasons(pb, orgId);
  if (stage === "fit_review") {
    // Already held: only a reason the current hold does not list yet is news (R2-CR-01).
    for (const r of await latestFitReasons(pb, orgId, "fit.hold")) known.add(r);
  }
  const unseen =
    fit.reasons.length === 0 || fit.reasons.some((r) => !known.has(r));
  return unseen ? fit : null;
}

/** The fit.hold audit event for a re-screen hold (written with the stage change). */
export function fitHoldEvent(
  orgId: string,
  fit: FitResult,
  trigger: "profile" | "send",
): AuditEvent {
  return {
    action: "fit.hold",
    organization: orgId,
    targetCollection: "organizations",
    targetId: orgId,
    meta: {
      reasons: fit.reasons,
      category: fit.category ?? "",
      verdict: fit.verdict,
      trigger,
    },
  };
}

// ---------------------------------------------------------------- staff review

export type FitCase = {
  orgId: string;
  name: string;
  businessType: string;
  description: string;
  stage: string;
  verdict: FitVerdict;
  reasons: string[];
  /** Every screened field that has text (R2-CR-01: staff see what the check read). */
  fields: { field: string; text: string }[];
  /** Pass to approveFit as `reviewed`: the approve is refused if the case changed since. */
  fingerprint: string;
};

type FitDeps = { transport?: EmailTransport; checker?: FitChecker };

/** An approve is bound to the case staff reviewed (R2-CR-01). */
export type ApproveFitDeps = FitDeps & {
  /** FitCase.fingerprint from the describeFitCase staff read. */
  reviewed: string;
  /** Needed to approve a case whose verdict is "blocked" (a never-hosted match). */
  overrideBlocked?: boolean;
};

export const FIT_CASE_CHANGED_COPY =
  "The business changed since you reviewed it. Run fit:review again.";
export const FIT_BLOCKED_COPY =
  "This matches a never-hosted category; pass --override-blocked to approve it.";
/** CR-D02: a paid order is declined through org:decline (full refund), never here. */
export const FIT_DECLINE_PAID_COPY =
  "Paid order: decline through org:decline, which refunds it.";

/**
 * CR-D02: true when the org holds money CDS would keep if this were a plain fit decline:
 * it has paid and its paid invoices are not fully refunded. A paid account with no mirrored
 * invoice yet (webhook lag) counts as paid, so the check fails closed.
 */
export function fitDeclineNeedsRefund(
  paidAt: string | null | undefined,
  invoices: readonly {
    status: string;
    amountCents: number;
    refundedCents: number;
  }[],
): boolean {
  const paid = invoices.filter((i) => i.status === "paid");
  if (paid.some((i) => i.amountCents - i.refundedCents > 0)) return true;
  return Boolean(paidAt) && paid.length === 0;
}

function orgIdOf(orgId: unknown): string {
  if (typeof orgId !== "string" || !ID_RE.test(orgId)) {
    throw new NotFound("not found");
  }
  return orgId;
}

function reasonOf(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < 1 || r.length > REASON_MAX) {
    throw new InvalidInput(
      `a reason is required (up to ${REASON_MAX} characters)`,
    );
  }
  return r;
}

type Loaded = {
  org: RecordModel;
  profile: RecordModel | null;
  intake: RecordModel | null;
  ownerAddress: string;
};

async function loadOrg(orgId: string): Promise<Loaded> {
  return withSuperuser(async (pb) => {
    let org: RecordModel;
    try {
      org = await pb.collection("organizations").getOne(orgId);
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound("not found");
      }
      throw err;
    }
    const one = async (collection: string, filter: string) => {
      try {
        return await pb.collection(collection).getFirstListItem(filter);
      } catch (err) {
        if (err instanceof ClientResponseError && err.status === 404) {
          return null;
        }
        throw err;
      }
    };
    const byOrg = pb.filter("organization = {:org}", { org: orgId });
    const profile = await one("business_profile", byOrg);
    const intake = await one("org_intake", byOrg);
    // A-WR-08: only a confirmed, non-bouncing default (newest first, as email/send.ts
    // orgIdentity reads it); a pending change is an address nobody has proved yet.
    const route = await pb
      .collection("org_email_routes")
      .getFirstListItem(
        pb.filter(
          "organization = {:org} && purpose = 'default' && confirmed_at != '' && bounced_at = ''",
          { org: orgId },
        ),
        { fields: "address", sort: "-confirmed_at" },
      )
      .catch((err: unknown) => {
        if (err instanceof ClientResponseError && err.status === 404) {
          return null;
        }
        throw err;
      });
    let ownerAddress = str(route?.address);
    if (!ownerAddress) {
      // Fall back to the owner's sign-in address (proved by the Submit code).
      const owner = await pb
        .collection("memberships")
        .getFirstListItem(
          pb.filter("organization = {:org} && role = 'owner'", { org: orgId }),
          { expand: "user", fields: "expand.user.email" },
        )
        .catch(() => null);
      const user = owner?.expand?.user as { email?: unknown } | undefined;
      ownerAddress = str(user?.email);
    }
    return { org, profile, intake, ownerAddress };
  });
}

/** The case a staff member sees before deciding: the org, its answers and the matched reasons. */
export async function describeFitCase(
  ctx: PlatformContext,
  orgId: string,
  deps: FitDeps = {},
): Promise<FitCase> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "fit_review");
  return readFitCase(orgId, deps);
}

/**
 * The case read with no authorization (in-package only, never re-exported from the root):
 * describeFitCase above and the 13-14 Pipeline › Fit holds read model (`console`, so support
 * agents see the case with the decisions disabled; decisions stay super_admin + fit_review).
 */
export async function readFitCase(
  orgId: string,
  deps: FitDeps = {},
): Promise<FitCase> {
  const id = orgIdOf(orgId);
  const { org, profile } = await loadOrg(id);
  const { fitCase } = await buildCase(
    id,
    org,
    profile,
    deps.checker ?? getFitChecker(),
  );
  return fitCase;
}

/** The case for a loaded org, and the checker result behind it. */
async function buildCase(
  id: string,
  org: RecordModel,
  profile: RecordModel | null,
  checker: FitChecker,
): Promise<{ fitCase: FitCase; result: FitResult }> {
  const input = orgFitInput(str(org.name), profile);
  const result = await checker.check(input);
  // A hold can carry a reason the checker cannot re-derive (B-WR-04: an earlier Submit from
  // this address was blocked), so the case also lists the latest fit.hold row's reasons.
  const held = await withSuperuser((pb) =>
    latestFitReasons(pb, id, "fit.hold"),
  );
  const reasons = [...result.reasons];
  for (const r of held) if (!reasons.includes(r)) reasons.push(r);
  const fields = screenedFields(input.name, profile);
  return {
    result,
    fitCase: {
      orgId: id,
      name: input.name,
      businessType: input.businessType,
      description: str(profile?.description),
      stage: str(org.stage),
      verdict: result.verdict,
      reasons,
      fields,
      fingerprint: fitFingerprint(fields, result.verdict, reasons),
    },
  };
}

/**
 * After an approve to intake: an intake sent meanwhile moves the org on to ready_for_build.
 * Returns true when it moved the org.
 */
async function reconcileSent(
  ctx: PlatformContext | SystemContext,
  id: string,
): Promise<boolean> {
  return withSuperuser(async (pb) => {
    const [org, intake] = await Promise.all([
      pb.collection("organizations").getOne(id, { fields: "stage" }),
      pb
        .collection("org_intake")
        .getFirstListItem(pb.filter("organization = {:org}", { org: id }), {
          fields: "submitted_at",
        })
        .catch(() => null),
    ]);
    if (org.stage !== "intake" || !str(intake?.submitted_at)) return false;
    const batch = pb.createBatch();
    batch.collection("organizations").update(id, { stage: "ready_for_build" });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "fit.reconcile",
        organization: id,
        targetCollection: "organizations",
        targetId: id,
        meta: { stage: "ready_for_build" },
      }),
    );
    await batch.send();
    return true;
  });
}

/**
 * R2-WR-01: the hourly job's sweep. Any org at intake whose intake is already sent (an approve
 * that raced a Send in another process, or whose reconcile failed) moves on to
 * ready_for_build. Returns how many moved; a failure is logged and left for the next run.
 */
export async function reconcileSentOrgs(ctx: SystemContext): Promise<number> {
  assertSystemContext(ctx);
  const rows = await withSuperuser((pb) =>
    pb.collection("org_intake").getFullList({
      filter: "submitted_at != '' && organization.stage = 'intake'",
      fields: "organization",
    }),
  );
  let n = 0;
  for (const row of rows) {
    const id = str(row.organization);
    if (!ID_RE.test(id)) continue;
    try {
      if (await withOrgLock(id, () => reconcileSent(ctx, id))) n += 1;
    } catch (err) {
      console.error(
        `[fit] reconcile failed for org ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return n;
}

async function decide(
  ctx: PlatformContext,
  orgId: string,
  reason: string,
  decision: "approve" | "decline",
  deps: FitDeps & { reviewed?: string; overrideBlocked?: boolean },
): Promise<void> {
  const id = orgIdOf(orgId);
  const why = reasonOf(reason);
  const checker = deps.checker ?? getFitChecker();

  // A-WR-07: read, decide and write under the org lock, so a Send to CDS in this process
  // cannot land between the read of submitted_at and the stage write.
  const { org, ownerAddress, patch } = await withOrgLock(id, async () => {
    const { org, profile, intake, ownerAddress } = await loadOrg(id);
    if (org.stage !== "fit_review") {
      throw new InvalidInput(
        "this organization is not waiting for a fit review",
      );
    }

    let patch: Record<string, unknown>;
    // The reasons this approval clears: a later re-screen holds again only for a new one.
    let cleared: string[] | undefined;
    if (decision === "approve") {
      // R2-CR-01: approve only the case staff reviewed. Any change to a screened field, the
      // verdict or the reasons since describeFitCase makes the fingerprint differ.
      const { fitCase, result } = await buildCase(id, org, profile, checker);
      if (!deps.reviewed || fitCase.fingerprint !== deps.reviewed) {
        throw new InvalidInput(FIT_CASE_CHANGED_COPY);
      }
      if (result.verdict === "blocked" && !deps.overrideBlocked) {
        throw new InvalidInput(FIT_BLOCKED_COPY);
      }
      cleared = result.reasons;
      patch = {
        stage: str(intake?.submitted_at) ? "ready_for_build" : "intake",
      };
      // A declined org was held; approving it gives members their access back. A disabled
      // org (billing, takedown) is never re-activated here.
      if (org.status === "held") patch.status = "active";
    } else {
      // CR-D02: the server is the gate. A paid order never closes here without its refund.
      const paidState = await withSuperuser(async (pb) => ({
        account: await billingAccountByOrg(pb, id),
        invoices: await invoiceMirrorsOf(pb, id),
      }));
      if (
        fitDeclineNeedsRefund(
          paidState.account?.paidAt ?? null,
          paidState.invoices,
        )
      ) {
        throw new InvalidInput(FIT_DECLINE_PAID_COPY);
      }
      patch = { status: "held" };
    }

    await withSuperuser(async (pb) => {
      const batch = pb.createBatch();
      batch.collection("organizations").update(id, patch);
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: decision === "approve" ? "fit.approve" : "fit.decline",
          organization: id,
          targetCollection: "organizations",
          targetId: id,
          meta: {
            reason: why,
            ...patch,
            ...(cleared ? { reasons: cleared } : {}),
          },
        }),
      );
      await batch.send();
    });
    return { org, ownerAddress, patch };
  });

  // The CLI runs in its own process, so the in-process lock cannot stop a Send in the web
  // app. If the intake was sent while this approval was written, finish the move. A failure
  // here does not undo the approval: the hourly job (reconcileSentOrgs) or the owner's next
  // Send finishes it (R2-WR-01), so it is logged rather than failing the CLI.
  if (patch.stage === "intake") {
    try {
      await reconcileSent(ctx, id);
    } catch (err) {
      console.error(
        `[fit] reconcile after approve failed for org ${id}; the hourly job retries: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!ownerAddress) {
    console.error(
      `[fit] org ${id} has no default email route; owner not emailed`,
    );
    return;
  }
  const orgName = str(org.name);
  try {
    if (decision === "approve") {
      await sendEmail(
        { kind: "cds", ctx },
        "fit.approved",
        ownerAddress,
        { orgName, link: platformUrl("/hub/setup") },
        { transport: deps.transport },
      );
    } else {
      await sendEmail(
        { kind: "cds", ctx },
        "fit.declined",
        ownerAddress,
        { orgName },
        { transport: deps.transport },
      );
    }
  } catch (err) {
    // The decision is recorded; the address is not logged.
    console.error(
      `[fit] fit.${decision === "approve" ? "approved" : "declined"} send failed for org ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Clear a held-for-review org (super_admin, audited, owner emailed). `deps.reviewed` is the
 * fingerprint of the case staff read (describeFitCase); a changed case is refused (R2-CR-01).
 */
export async function approveFit(
  ctx: PlatformContext,
  orgId: string,
  reason: string,
  deps: ApproveFitDeps,
): Promise<void> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "fit_review");
  await decide(ctx, orgId, reason, "approve", deps);
}

/** Decline a held-for-review org: it is held, the owner is emailed (super_admin, audited). */
export async function declineFit(
  ctx: PlatformContext,
  orgId: string,
  reason: string,
  deps: FitDeps = {},
): Promise<void> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "fit_review");
  await decide(ctx, orgId, reason, "decline", deps);
}
