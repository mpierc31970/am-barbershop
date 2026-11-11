// packages/db/src/staff/review/cases.ts (13-23; STAFF-23, STAFF-24, STAFF-26; D248, D249, D292,
// P13-P8, P13-P25). Review cases R-<seq> and the outcomes the one review queue acts with.
//
// - Cases live in the platform collection `review_cases` (kind spot_check | report | dmca); the
//   site is `org_id` text (P13-P5). One sequence: max(seq) + 1, retried on the unique index
//   (support/incidents.ts pattern). Scan flags and holds are never copied here (P13-P8).
// - staffCreateCase ("Log a report", `review_queue`) and createPublicReport (`/report`, 13-30,
//   system context) create a report or DMCA case with steps [received]. A case NEVER opens a
//   ticket (STAFF-26, T-13-23-04): the owner gets `report.content_notice` (URL + category only,
//   never the reporter, T-13-23-01) and the reporter `report.received` (never the owner).
// - staffAddCaseStep walks the D249 timeline in order: received -> content_disabled ->
//   tenant_notified -> counter_notice -> restore_date_set (10-14 business days after the
//   counter-notice) -> restored | upheld -> closed.
// - staffCaseOutcome / staffResolveFlag call the existing functions: cleared releases the hold
//   (held page publishes with the staff verdict, held photo -> ready) and resolves the flags;
//   fix_requested -> staffSendSuspensionNotice; removed -> page taken offline or takedownMedia
//   (super_admin, its own gate); suspended -> staffSuspendNow (super_admin, its own gate,
//   T-13-23-02). Every outcome writes one `review.outcome` audit row with the organization
//   (T-13-23-03).
// - repeatInfringers: >= 3 dmca cases upheld in the trailing 365 days per org (P13-P25).
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { businessDeadline, SLA_BUSINESS_DAYS } from "@cds/core/support";
import { businessDate } from "@cds/core/today";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../../audit";
import { withSuperuser } from "../../client";
import { withOrgLock } from "../../content/lock";
import { readManifest } from "../../content/manifest";
import {
  liveTag,
  pageTag,
  siteTag,
  type ContentScanner,
  type Invalidator,
} from "../../content/ports";
import { publishPage, type PublishDeps } from "../../content/publish";
import { refreshSiteIndex } from "../../content/site-index/build";
import {
  assertPlatformContext,
  mintOrgContext,
  mintSystemContext,
  type PlatformContext,
} from "../../context";
import { platformUrl } from "../../email/env";
import { sendEmail } from "../../email/send";
import type { EmailTransport } from "../../email/transport";
import { takedownMedia, type TakedownDeps } from "../../media/ops/takedown";
import { isUniqueViolation } from "../../payments/staff-alert";
import { takeReportReceipt } from "../../rate-limit";
import { newRecordId } from "../../repository";
import { resolveOrganization } from "../../resolve";
import {
  getObjectStore,
  tenantSiteManifestKey,
  type ObjectStore,
} from "../../storage";
import { staffSendSuspensionNotice, staffSuspendNow } from "../suspension";

const CASES = "review_cases";
const FLAGS = "content_flags";
const SEQ_RETRIES = 5;
const ID_RE = /^[a-z0-9]{15}$/;
const REF_RE = /^R-([1-9][0-9]{0,8})$/i;
const DAY_MS = 86_400_000;
const JSON_TYPE = "application/json";

/** Report description, reporter name and URL caps (migration 873). */
export const REVIEW_DESCRIPTION_MAX = 5000;
export const REVIEW_REPORTER_NAME_MAX = 200;
export const REVIEW_URL_MAX = 2000;
export const REVIEW_NOTE_MAX = 1000;
/** Restore date window after a counter-notice, in business days (D249). */
export const REVIEW_RESTORE_MIN_BUSINESS_DAYS = 10;
export const REVIEW_RESTORE_MAX_BUSINESS_DAYS = 14;
/** Repeat infringer: this many upheld DMCA cases in the trailing window (P13-P25). */
export const REPEAT_INFRINGER_UPHELD = 3;
export const REPEAT_INFRINGER_WINDOW_DAYS = 365;

export const REVIEW_CASE_KINDS = ["spot_check", "report", "dmca"] as const;
export type ReviewCaseKind = (typeof REVIEW_CASE_KINDS)[number];

export const REVIEW_REPORT_CATEGORIES = [
  "copyright",
  "scam",
  "illegal",
  "other",
] as const;
export type ReviewReportCategory = (typeof REVIEW_REPORT_CATEGORIES)[number];

/** What the owner and reporter read (email `categoryLabel`). */
export const REVIEW_CATEGORY_LABELS: Readonly<
  Record<ReviewReportCategory | "spot_check", string>
> = Object.freeze({
  copyright: "Copyright",
  scam: "Scam or fraud",
  illegal: "Illegal content",
  other: "Other",
  spot_check: "Spot check",
});

/** The D249 timeline, in order. `restored` and `upheld` are alternatives. */
export const REVIEW_CASE_STEPS = [
  "received",
  "content_disabled",
  "tenant_notified",
  "counter_notice",
  "restore_date_set",
  "restored",
  "upheld",
  "closed",
] as const;
export type ReviewCaseStep = (typeof REVIEW_CASE_STEPS)[number];

const STEP_RANK: Readonly<Record<ReviewCaseStep, number>> = {
  received: 0,
  content_disabled: 1,
  tenant_notified: 2,
  counter_notice: 3,
  restore_date_set: 4,
  restored: 5,
  upheld: 5,
  closed: 6,
};
const DMCA_ONLY_STEPS: ReadonlySet<ReviewCaseStep> = new Set([
  "counter_notice",
  "restore_date_set",
  "restored",
  "upheld",
]);

export const REVIEW_OUTCOMES = [
  "cleared",
  "fix_requested",
  "removed",
  "suspended",
  "upheld",
  "restored",
  "rejected",
] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];
/** Outcomes the queue can apply to a flag or hold without a case row (choice 3). */
export type ReviewFlagOutcome =
  "cleared" | "fix_requested" | "removed" | "suspended";

export type ReviewCaseStatus = "open" | "waiting" | "closed";

export type ReviewCaseStepEntry = {
  step: ReviewCaseStep;
  at: string;
  /** Staff user id, or "" for the public form / a job. */
  by: string;
  note?: string;
  /** ISO; restore_date_set only. */
  restoreDate?: string;
};

export type ReviewDmcaStatement = {
  good_faith: boolean;
  accuracy: boolean;
  signature: string;
  signed_at: string;
};

/** A case as the console reads it (staff only: reporter fields included). */
export type StaffReviewCase = {
  id: string;
  ref: string;
  seq: number;
  kind: ReviewCaseKind;
  orgId: string | null;
  business: string | null;
  targetUrl: string;
  targetCollection: string;
  targetId: string;
  category: ReviewReportCategory | "spot_check" | "";
  description: string;
  reporterName: string;
  reporterEmail: string;
  dmcaStatement: ReviewDmcaStatement | null;
  status: ReviewCaseStatus;
  steps: ReviewCaseStepEntry[];
  currentStep: ReviewCaseStep | null;
  dueAt: string | null;
  assignee: string | null;
  outcome: ReviewOutcome | null;
  pages: unknown[];
  repeatInfringer: boolean;
  created: string;
  updated: string;
};

export type ReviewCaseInput = {
  kind: "report" | "dmca";
  orgId?: string | null;
  targetUrl: string;
  category: string;
  description: string;
  reporter?: { name?: string; email?: string } | null;
  dmcaStatement?: {
    goodFaith: boolean;
    accuracy: boolean;
    signature: string;
  } | null;
  /** "Received by" in the Log a report drawer. */
  receivedVia?: "email" | "phone" | "other";
  /** "Received at"; defaults to now. */
  receivedAt?: Date | string | null;
};

export type PublicReportInput = {
  targetUrl: string;
  category: string;
  description: string;
  reporterName?: string | null;
  reporterEmail?: string | null;
  dmcaStatement?: ReviewCaseInput["dmcaStatement"];
};

export type ReviewDeps = {
  now?: Date;
  transport?: EmailTransport;
};

export type ReviewOutcomeOptions = {
  now?: Date;
  /** Staff-only note (audit-free text kept on the case step). */
  note?: string;
  /** What the owner reads: required for fix_requested. */
  message?: string;
  /** suspended: illegal | legal_demand | dmca (default dmca for DMCA cases, else illegal). */
  suspendCategory?: "illegal" | "legal_demand" | "dmca";
  /** removed (media): the takedown reason; defaults to the case ref. */
  reason?: string;
  transport?: EmailTransport;
  invalidator?: Invalidator;
  /** Content deps for a held page clear (publish) and a page removal (sections + store). */
  content?: PublishDeps;
  /** Media deps for a takedown (sections, invalidator, stores). */
  media?: TakedownDeps;
};

export type ReviewOutcomeResult = {
  ref: string;
  outcome: ReviewOutcome;
  orgId: string | null;
  /** cleared: flags resolved; removed: also. */
  flagsResolved: number;
};

// ---------------------------------------------------------------------------------------
// Small helpers

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function validNow(now: Date | undefined): Date {
  const d = now ?? new Date();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  return d;
}

function dateOf(v: Date | string | null | undefined, what: string): Date {
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) {
    throw new InvalidInput(`${what} must be a valid date`);
  }
  return d;
}

export function reviewCaseRef(seq: number): string {
  return `R-${seq}`;
}

function textOf(
  v: unknown,
  what: string,
  max: number,
  required: boolean,
): string {
  if (v === undefined || v === null) {
    if (required) throw new InvalidInput(`add ${what}`);
    return "";
  }
  if (typeof v !== "string") throw new InvalidInput(`${what} must be text`);
  const s = v.trim();
  if (required && s === "") throw new InvalidInput(`add ${what}`);
  if (s.length > max) {
    throw new InvalidInput(`${what} must be at most ${max} characters`);
  }
  return s;
}

function urlOf(v: unknown): { url: string; host: string } {
  const raw = textOf(v, "the page address", REVIEW_URL_MAX, true);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new InvalidInput(
      "Enter the full page address, starting with https://",
    );
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new InvalidInput(
      "Enter the full page address, starting with https://",
    );
  }
  return { url: u.toString(), host: u.hostname };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailOf(v: unknown, required: boolean): string {
  const s = textOf(v, "an email address", 254, required).toLowerCase();
  if (s !== "" && !EMAIL_RE.test(s)) {
    throw new InvalidInput("Enter a valid email address.");
  }
  return s;
}

function categoryOf(v: unknown): ReviewReportCategory {
  if (
    typeof v === "string" &&
    (REVIEW_REPORT_CATEGORIES as readonly string[]).includes(v)
  ) {
    return v as ReviewReportCategory;
  }
  throw new InvalidInput("Pick what kind of problem this is.");
}

function assertOrgId(v: unknown): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new NotFound();
  return v;
}

function stepsOf(v: unknown): ReviewCaseStepEntry[] {
  if (!Array.isArray(v)) return [];
  const out: ReviewCaseStepEntry[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const r = e as Record<string, unknown>;
    const step = str(r.step) as ReviewCaseStep;
    if (!(step in STEP_RANK)) continue;
    out.push({
      step,
      at: str(r.at),
      by: str(r.by),
      ...(str(r.note) ? { note: str(r.note) } : {}),
      ...(str(r.restoreDate) ? { restoreDate: str(r.restoreDate) } : {}),
    });
  }
  return out;
}

function lastStep(steps: ReviewCaseStepEntry[]): ReviewCaseStepEntry | null {
  return steps.length > 0 ? (steps[steps.length - 1] ?? null) : null;
}

function statementOf(
  v: ReviewCaseInput["dmcaStatement"],
  now: Date,
): ReviewDmcaStatement {
  if (!v || v.goodFaith !== true || v.accuracy !== true) {
    throw new InvalidInput(
      "A copyright notice needs both statements ticked and a signature.",
    );
  }
  const signature = textOf(
    v.signature,
    "a signature",
    REVIEW_REPORTER_NAME_MAX,
    true,
  );
  return {
    good_faith: true,
    accuracy: true,
    signature,
    signed_at: now.toISOString(),
  };
}

function parseStatement(v: unknown): ReviewDmcaStatement | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.good_faith !== true && r.accuracy !== true && !str(r.signature)) {
    return null;
  }
  return {
    good_faith: r.good_faith === true,
    accuracy: r.accuracy === true,
    signature: str(r.signature),
    signed_at: str(r.signed_at),
  };
}

async function nextCaseSeq(pb: PocketBase): Promise<number> {
  const res = await pb
    .collection(CASES)
    .getList(1, 1, { sort: "-seq", fields: "seq" });
  const top = res.items[0];
  return (top && typeof top.seq === "number" ? top.seq : 0) + 1;
}

/** A case by record id or `R-<seq>`. Junk and missing: NotFound. */
async function loadCase(pb: PocketBase, raw: unknown): Promise<RecordModel> {
  if (typeof raw !== "string") throw new NotFound("case not found");
  const v = raw.trim();
  const m = REF_RE.exec(v);
  let filter: string;
  if (m) filter = pb.filter("seq = {:seq}", { seq: Number(m[1]) });
  else if (ID_RE.test(v)) filter = pb.filter("id = {:id}", { id: v });
  else throw new NotFound("case not found");
  try {
    return await pb.collection(CASES).getFirstListItem(filter);
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound("case not found");
    }
    throw err;
  }
}

async function orgName(pb: PocketBase, orgId: string): Promise<string | null> {
  if (!orgId) return null;
  const row = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" })
    .catch(() => null);
  return row ? str(row.name) || "your site" : null;
}

/** Owners' and Admins' addresses (the people who can act on a report). */
async function ownerAdminEmails(
  pb: PocketBase,
  orgId: string,
): Promise<string[]> {
  const rows = await pb.collection("memberships").getFullList({
    filter: pb.filter(
      "organization = {:org} && (role = 'owner' || role = 'admin')",
      { org: orgId },
    ),
    expand: "user",
    fields: "expand.user.email",
  });
  const out = new Set<string>();
  for (const r of rows) {
    const e = str((r.expand?.user as { email?: unknown } | undefined)?.email);
    if (e !== "") out.add(e);
  }
  return [...out];
}

// ---------------------------------------------------------------------------------------
// Create

type CreateBody = {
  kind: "report" | "dmca";
  orgId: string;
  url: string;
  category: ReviewReportCategory;
  description: string;
  reporterName: string;
  reporterEmail: string;
  statement: ReviewDmcaStatement | null;
  received: ReviewCaseStepEntry;
  dueAt: Date;
  createdBy: string;
  /** The page the URL points at, when it is one of the org's pages. */
  targetPage?: string;
};

async function insertCase(
  pb: PocketBase,
  auditCtx: PlatformContext | ReturnType<typeof mintSystemContext>,
  b: CreateBody,
): Promise<{ id: string; ref: string; seq: number }> {
  for (let attempt = 0; attempt < SEQ_RETRIES; attempt++) {
    const seq = await nextCaseSeq(pb);
    const id = newRecordId();
    const batch = pb.createBatch();
    batch.collection(CASES).create({
      id,
      seq,
      kind: b.kind,
      org_id: b.orgId,
      target_url: b.url,
      target_collection: b.targetPage ? "pages" : "",
      target_id: b.targetPage ?? "",
      category: b.category,
      description: b.description,
      reporter_name: b.reporterName,
      reporter_email: b.reporterEmail,
      dmca_statement: b.statement,
      status: "open",
      steps: [b.received],
      due_at: b.dueAt.toISOString(),
      assignee: "",
      outcome: "",
      pages: [],
      created_by: b.createdBy,
    });
    batch.collection("audit_log").create(
      auditBody(auditCtx, {
        action: "review.case_created",
        organization: b.orgId || null,
        targetCollection: CASES,
        targetId: id,
        meta: { ref: reviewCaseRef(seq), kind: b.kind, category: b.category },
      }),
    );
    try {
      await batch.send();
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
    return { id, ref: reviewCaseRef(seq), seq };
  }
  throw new InvalidInput("case numbers are busy; try again");
}

/** The org's page a reported URL points at (by slug; "/" is Home), else undefined. */
async function pageForUrl(
  pb: PocketBase,
  orgId: string,
  url: string,
): Promise<string | undefined> {
  if (!orgId) return undefined;
  let slug: string;
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    slug = path === "" ? "home" : (path.split("/")[0] ?? "");
  } catch {
    return undefined;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return undefined;
  const res = await pb.collection("pages").getList(1, 1, {
    filter: pb.filter(
      "organization = {:org} && slug = {:slug} && deleted_at = ''",
      {
        org: orgId,
        slug,
      },
    ),
    fields: "id",
  });
  return res.items[0]?.id;
}

function normalizeCreate(
  input: ReviewCaseInput,
  now: Date,
): Omit<CreateBody, "orgId" | "received" | "dueAt" | "createdBy"> & {
  host: string;
} {
  const kind = input?.kind;
  if (kind !== "report" && kind !== "dmca") {
    throw new InvalidInput("A case is a report or a copyright (DMCA) notice.");
  }
  const { url, host } = urlOf(input.targetUrl);
  const category = categoryOf(input.category);
  if (kind === "dmca" && category !== "copyright") {
    throw new InvalidInput("A DMCA notice is a copyright report.");
  }
  const description = textOf(
    input.description,
    "a description",
    REVIEW_DESCRIPTION_MAX,
    true,
  );
  const reporterName = textOf(
    input.reporter?.name,
    "a name",
    REVIEW_REPORTER_NAME_MAX,
    kind === "dmca",
  );
  const reporterEmail = emailOf(input.reporter?.email, kind === "dmca");
  const statement =
    kind === "dmca" ? statementOf(input.dmcaStatement, now) : null;
  return {
    kind,
    url,
    host,
    category,
    description,
    reporterName,
    reporterEmail,
    statement,
  };
}

/**
 * "Log a report" (`review_queue`, both roles): abuse@ mail or a phone call entered by hand.
 * No owner mail and never a ticket ("The owner was not contacted."). The org comes from
 * `orgId` or the URL's host.
 */
export async function staffCreateCase(
  ctx: PlatformContext,
  input: ReviewCaseInput,
  deps: Pick<ReviewDeps, "now"> = {},
): Promise<{ id: string; ref: string; orgId: string | null }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "review_queue");
  const now = validNow(deps.now);
  const v = normalizeCreate(input, now);
  const receivedAt =
    input.receivedAt === undefined ||
    input.receivedAt === null ||
    input.receivedAt === ""
      ? now
      : dateOf(input.receivedAt, "received at");
  const via =
    input.receivedVia === "email" ||
    input.receivedVia === "phone" ||
    input.receivedVia === "other"
      ? input.receivedVia
      : null;
  let orgId = "";
  if (input.orgId) orgId = assertOrgId(input.orgId);
  else orgId = (await resolveOrganization(v.host))?.orgId ?? "";
  const created = await withSuperuser(async (pb) => {
    if (orgId && (await orgName(pb, orgId)) === null) throw new NotFound();
    const targetPage = await pageForUrl(pb, orgId, v.url);
    return insertCase(pb, ctx, {
      ...v,
      orgId,
      ...(targetPage ? { targetPage } : {}),
      received: {
        step: "received",
        at: receivedAt.toISOString(),
        by: ctx.actor,
        ...(via ? { note: `Received by ${via}` } : {}),
      },
      dueAt: businessDeadline(receivedAt, SLA_BUSINESS_DAYS),
      createdBy: ctx.actor,
    });
  });
  return { id: created.id, ref: created.ref, orgId: orgId || null };
}

/**
 * The public `/report` form (13-30; system context, the caller owns Turnstile and the rate
 * limit). Resolves the org from the URL's host, creates the case with steps [received], then,
 * best effort: `report.received` to the reporter (when an address was given) and
 * `report.content_notice` to the site's Owners and Admins (URL + category only). Never a
 * ticket (STAFF-26).
 */
export async function createPublicReport(
  input: PublicReportInput,
  deps: ReviewDeps = {},
): Promise<{
  ref: string;
  orgId: string | null;
  ownerNotified: number;
  reporterNotified: boolean;
}> {
  const now = validNow(deps.now);
  const category = categoryOf(input?.category);
  const kind: "report" | "dmca" =
    category === "copyright" && input.dmcaStatement ? "dmca" : "report";
  const v = normalizeCreate(
    {
      kind,
      targetUrl: input.targetUrl,
      category,
      description: input.description,
      reporter: {
        name: input.reporterName ?? undefined,
        email: input.reporterEmail ?? undefined,
      },
      dmcaStatement: input.dmcaStatement ?? null,
    },
    now,
  );
  const sys = mintSystemContext({ job: "report" });
  const resolved = await resolveOrganization(v.host);
  const orgId = resolved?.orgId ?? "";
  const { ref, business, owners } = await withSuperuser(async (pb) => {
    const targetPage = await pageForUrl(pb, orgId, v.url);
    const created = await insertCase(pb, sys, {
      ...v,
      orgId,
      ...(targetPage ? { targetPage } : {}),
      received: { step: "received", at: now.toISOString(), by: "" },
      dueAt: businessDeadline(now, SLA_BUSINESS_DAYS),
      createdBy: "",
    });
    const business = orgId ? await orgName(pb, orgId) : null;
    let owners: string[] = [];
    if (orgId) {
      try {
        owners = await ownerAdminEmails(pb, orgId);
      } catch (err) {
        console.error(`[review] owner lookup failed ${errName(err)}`);
      }
    }
    return { ref: created.ref, business, owners };
  });

  const categoryLabel = REVIEW_CATEGORY_LABELS[category];
  const transportOpt = deps.transport ? { transport: deps.transport } : {};
  let reporterNotified = false;
  if (v.reporterEmail && takeReportReceipt(v.reporterEmail)) {
    try {
      await sendEmail(
        { kind: "cds", ctx: sys },
        "report.received",
        v.reporterEmail,
        { caseCode: ref, url: v.url, categoryLabel },
        { now, ...transportOpt },
      );
      reporterNotified = true;
    } catch (err) {
      console.error(`[review] reporter email failed ${errName(err)}`);
    }
  }
  let ownerNotified = 0;
  for (const addr of owners) {
    if (addr === v.reporterEmail) continue;
    try {
      await sendEmail(
        { kind: "cds", ctx: sys },
        "report.content_notice",
        addr,
        {
          business: business ?? "your site",
          url: v.url,
          categoryLabel,
          href: platformUrl("/hub"),
        },
        { now, concernsOrg: orgId, ...transportOpt },
      );
      ownerNotified += 1;
    } catch (err) {
      console.error(`[review] owner email failed ${errName(err)}`);
    }
  }
  return { ref, orgId: orgId || null, ownerNotified, reporterNotified };
}

// ---------------------------------------------------------------------------------------
// Read

function toCase(
  r: RecordModel,
  business: string | null,
  repeat: boolean,
): StaffReviewCase {
  const steps = stepsOf(r.steps);
  const seq = Number(r.seq) || 0;
  const outcome = str(r.outcome);
  const category = str(r.category);
  return {
    id: r.id,
    ref: reviewCaseRef(seq),
    seq,
    kind: str(r.kind) as ReviewCaseKind,
    orgId: str(r.org_id) || null,
    business,
    targetUrl: str(r.target_url),
    targetCollection: str(r.target_collection),
    targetId: str(r.target_id),
    category: category as StaffReviewCase["category"],
    description: str(r.description),
    reporterName: str(r.reporter_name),
    reporterEmail: str(r.reporter_email),
    dmcaStatement: parseStatement(r.dmca_statement),
    status: (str(r.status) || "open") as ReviewCaseStatus,
    steps,
    currentStep: lastStep(steps)?.step ?? null,
    dueAt: str(r.due_at) || null,
    assignee: str(r.assignee) || null,
    outcome: outcome ? (outcome as ReviewOutcome) : null,
    pages: Array.isArray(r.pages) ? (r.pages as unknown[]) : [],
    repeatInfringer: repeat,
    created: str(r.created),
    updated: str(r.updated),
  };
}

/** One case by `R-<n>` or id (staff only; reporter fields included). */
export async function staffGetCase(
  ctx: PlatformContext,
  ref: string,
  opts: { now?: Date } = {},
): Promise<StaffReviewCase> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "review_queue");
  const now = validNow(opts.now);
  const { row, business } = await withSuperuser(async (pb) => {
    const row = await loadCase(pb, ref);
    return { row, business: await orgName(pb, str(row.org_id)) };
  });
  const orgId = str(row.org_id);
  const repeat = orgId
    ? (await repeatInfringerFor([orgId], { now })).has(orgId)
    : false;
  return toCase(row, business, repeat);
}

/** Case row -> console view (the queue maps through this). */
export function reviewCaseView(
  r: RecordModel,
  business: string | null,
  repeat = false,
): StaffReviewCase {
  return toCase(r, business, repeat);
}

// ---------------------------------------------------------------------------------------
// Steps and assignment

/** Assign a case to a staff user id, or null to unassign (`review_queue`). Audited. */
export async function staffAssignCase(
  ctx: PlatformContext,
  ref: string,
  assignee: string | null,
): Promise<{ ref: string; assignee: string | null }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "review_queue");
  if (
    assignee !== null &&
    (typeof assignee !== "string" || !ID_RE.test(assignee))
  ) {
    throw new InvalidInput("Pick a CDS staff member.");
  }
  return withSuperuser(async (pb) => {
    const row = await loadCase(pb, ref);
    if (assignee !== null) {
      const u = await pb
        .collection("users")
        .getOne(assignee, { fields: "id,staff_role" })
        .catch(() => null);
      if (!u || !str(u.staff_role))
        throw new InvalidInput("Pick a CDS staff member.");
    }
    const code = reviewCaseRef(Number(row.seq) || 0);
    const batch = pb.createBatch();
    batch.collection(CASES).update(row.id, { assignee: assignee ?? "" });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "review.assigned",
        organization: str(row.org_id) || null,
        targetCollection: CASES,
        targetId: row.id,
        meta: { ref: code, assignee: assignee ?? "" },
      }),
    );
    await batch.send();
    return { ref: code, assignee };
  });
}

function restoreDateOk(counterAt: Date, restore: Date): boolean {
  const tz = "America/Chicago";
  const lo = businessDate(
    businessDeadline(counterAt, REVIEW_RESTORE_MIN_BUSINESS_DAYS),
    tz,
  );
  const hi = businessDate(
    businessDeadline(counterAt, REVIEW_RESTORE_MAX_BUSINESS_DAYS),
    tz,
  );
  const day = businessDate(restore, tz);
  return day >= lo && day <= hi;
}

function statusAfter(
  step: ReviewCaseStep,
  prev: ReviewCaseStatus,
): ReviewCaseStatus {
  if (step === "closed") return "closed";
  if (step === "counter_notice" || step === "restore_date_set")
    return "waiting";
  if (step === "restored" || step === "upheld") return "open";
  return prev === "closed" ? "closed" : prev;
}

/** Validate a step against the timeline; returns the entry to append. */
function nextStepEntry(
  row: RecordModel,
  step: unknown,
  by: string,
  now: Date,
  opts: { note?: string; restoreDate?: Date | string | null },
): ReviewCaseStepEntry {
  if (typeof step !== "string" || !(step in STEP_RANK)) {
    throw new InvalidInput("unknown case step");
  }
  const s = step as ReviewCaseStep;
  const kind = str(row.kind) as ReviewCaseKind;
  const steps = stepsOf(row.steps);
  const last = lastStep(steps);
  if (str(row.status) === "closed" || last?.step === "closed") {
    throw new InvalidInput("This case is closed.");
  }
  if (DMCA_ONLY_STEPS.has(s) && kind !== "dmca") {
    throw new InvalidInput("That step is for copyright (DMCA) cases.");
  }
  if (last && STEP_RANK[s] <= STEP_RANK[last.step]) {
    throw new InvalidInput("That step is already past.");
  }
  const note = textOf(opts.note, "note", REVIEW_NOTE_MAX, false);
  const entry: ReviewCaseStepEntry = {
    step: s,
    at: now.toISOString(),
    by,
    ...(note ? { note } : {}),
  };
  if (s === "restore_date_set") {
    const counter = steps.find((e) => e.step === "counter_notice");
    if (!counter) throw new InvalidInput("Record the counter-notice first.");
    const restore = dateOf(opts.restoreDate ?? null, "restore date");
    if (!restoreDateOk(dateOf(counter.at, "counter-notice date"), restore)) {
      throw new InvalidInput(
        `The restore date must be ${REVIEW_RESTORE_MIN_BUSINESS_DAYS}-${REVIEW_RESTORE_MAX_BUSINESS_DAYS} business days after the counter-notice.`,
      );
    }
    entry.restoreDate = restore.toISOString();
  }
  if (s === "restored" && !steps.some((e) => e.step === "restore_date_set")) {
    throw new InvalidInput("Set the restore date first.");
  }
  return entry;
}

/** Record the next timeline step (`review_queue`). Audited as `review.step`. */
export async function staffAddCaseStep(
  ctx: PlatformContext,
  ref: string,
  input: {
    step: ReviewCaseStep;
    note?: string;
    restoreDate?: Date | string | null;
    now?: Date;
  },
): Promise<StaffReviewCase> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "review_queue");
  const now = validNow(input?.now);
  const { row, business } = await withSuperuser(async (pb) => {
    const row = await loadCase(pb, ref);
    const entry = nextStepEntry(row, input?.step, ctx.actor, now, input ?? {});
    const steps = [...stepsOf(row.steps), entry];
    const status = statusAfter(
      entry.step,
      (str(row.status) || "open") as ReviewCaseStatus,
    );
    const code = reviewCaseRef(Number(row.seq) || 0);
    const patch: Record<string, unknown> = { steps, status };
    if (entry.step === "restore_date_set" && entry.restoreDate) {
      patch.due_at = entry.restoreDate;
    }
    const batch = pb.createBatch();
    batch.collection(CASES).update(row.id, patch);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "review.step",
        organization: str(row.org_id) || null,
        targetCollection: CASES,
        targetId: row.id,
        meta: { ref: code, step: entry.step },
      }),
    );
    await batch.send();
    const fresh = await pb.collection(CASES).getOne(row.id);
    return { row: fresh, business: await orgName(pb, str(row.org_id)) };
  });
  return toCase(row, business, false);
}

// ---------------------------------------------------------------------------------------
// Spot-check pages (13-38 choice 1)

export const SPOT_PAGE_STATES = ["ok", "issue"] as const;
export type SpotPageState = (typeof SPOT_PAGE_STATES)[number];

/** One page on a spot-check case, as the console reads it. */
export type SpotCheckPageView = {
  pageId: string;
  title: string;
  /** The page slug (cases opened before WR-D03 have none). */
  slug?: string;
  state: "unchecked" | SpotPageState;
  note?: string;
  at?: string;
  by?: string;
};

/** The `pages` json of a spot-check case, typed for the console (unknown shapes dropped). */
export function spotCheckPages(pages: readonly unknown[]): SpotCheckPageView[] {
  const out: SpotCheckPageView[] = [];
  for (const p of pages) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const pageId = str(r.page_id);
    if (!pageId) continue;
    const state = str(r.state);
    out.push({
      pageId,
      title: str(r.title),
      ...(str(r.slug) ? { slug: str(r.slug) } : {}),
      state: state === "ok" || state === "issue" ? state : "unchecked",
      ...(str(r.note) ? { note: str(r.note) } : {}),
      ...(str(r.at) ? { at: str(r.at) } : {}),
      ...(str(r.by) ? { by: str(r.by) } : {}),
    });
  }
  return out;
}

/**
 * Mark one page of an open spot-check case OK or Issue (`review_queue`, both roles). An issue
 * keeps an optional staff note; the case stays open so Ask to fix / Remove content can follow.
 * Audited `review.spot_page` with the organization.
 */
export async function staffMarkSpotPage(
  ctx: PlatformContext,
  ref: string,
  input: { pageId: string; state: SpotPageState; note?: string; now?: Date },
): Promise<StaffReviewCase> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "review_queue");
  const now = validNow(input?.now);
  const state = input?.state;
  if (state !== "ok" && state !== "issue") {
    throw new InvalidInput("Mark the page OK or Issue.");
  }
  const pageId = input?.pageId;
  if (typeof pageId !== "string" || !ID_RE.test(pageId)) throw new NotFound();
  const note =
    state === "issue" ? textOf(input.note, "note", REVIEW_NOTE_MAX, false) : "";
  const { row, business } = await withSuperuser(async (pb) => {
    const row = await loadCase(pb, ref);
    if (str(row.kind) !== "spot_check") {
      throw new InvalidInput("That case is not a spot check.");
    }
    if (str(row.status) === "closed") {
      throw new InvalidInput("This case is closed.");
    }
    const pages = Array.isArray(row.pages) ? (row.pages as unknown[]) : [];
    let found = false;
    const next = pages.map((p) => {
      if (!p || typeof p !== "object") return p;
      const r = p as Record<string, unknown>;
      if (str(r.page_id) !== pageId) return p;
      found = true;
      const rest = { ...r };
      delete rest.note;
      return {
        ...rest,
        state,
        at: now.toISOString(),
        by: ctx.actor,
        ...(note ? { note } : {}),
      };
    });
    if (!found) throw new NotFound("page not on this case");
    const code = reviewCaseRef(Number(row.seq) || 0);
    const batch = pb.createBatch();
    batch.collection(CASES).update(row.id, { pages: next });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "review.spot_page",
        organization: str(row.org_id) || null,
        targetCollection: CASES,
        targetId: row.id,
        meta: { ref: code, page: pageId, state },
      }),
    );
    await batch.send();
    const fresh = await pb.collection(CASES).getOne(row.id);
    return { row: fresh, business: await orgName(pb, str(row.org_id)) };
  });
  return toCase(row, business, false);
}

// ---------------------------------------------------------------------------------------
// Outcomes

/** The staff verdict a cleared hold publishes with: the case was reviewed by a person. */
const STAFF_CLEARED: ContentScanner = {
  scan: () => Promise.resolve({ verdict: "clean", reasons: [] }),
};

function ownerView(ctx: PlatformContext, orgId: string) {
  return mintOrgContext({
    orgId,
    actor: ctx.actor,
    role: "owner",
    grants: [],
    impersonator: ctx.actor,
    ip: ctx.ip,
  });
}

type Target = { orgId: string; collection: string; id: string };

/** Open/queued flags on one target -> resolved (batch ops). */
async function openFlagIds(pb: PocketBase, t: Target): Promise<string[]> {
  const rows = await pb.collection(FLAGS).getFullList({
    filter: pb.filter(
      "organization = {:org} && target_collection = {:c} && target_id = {:id} && (status = 'open' || status = 'queued')",
      { org: t.orgId, c: t.collection, id: t.id },
    ),
    fields: "id",
  });
  return rows.map((r) => r.id);
}

/**
 * Clear: release the hold and resolve the target's flags. A held page publishes with the
 * staff verdict (needs `content` deps); a held photo goes back to `ready`; any other record
 * keeps its saved state (its flags resolve).
 */
async function clearTarget(
  ctx: PlatformContext,
  t: Target,
  opts: ReviewOutcomeOptions,
): Promise<{
  flagIds: string[];
  extra: { collection: string; id: string; body: Record<string, unknown> }[];
}> {
  const extra: {
    collection: string;
    id: string;
    body: Record<string, unknown>;
  }[] = [];
  if (t.collection === "pages") {
    const page = await withSuperuser((pb) =>
      pb
        .collection("pages")
        .getFirstListItem(
          pb.filter("id = {:id} && organization = {:org}", {
            id: t.id,
            org: t.orgId,
          }),
          { fields: "id,status" },
        )
        .catch(() => null),
    );
    if (page && str(page.status) === "held") {
      if (!opts.content?.sections) {
        throw new InvalidInput(
          "Clearing a held page needs the content registry.",
        );
      }
      await publishPage(ownerView(ctx, t.orgId), t.id, {
        ...opts.content,
        scanner: STAFF_CLEARED,
      });
    }
  } else if (t.collection === "media_assets") {
    const row = await withSuperuser((pb) =>
      pb
        .collection("media_assets")
        .getFirstListItem(
          pb.filter("id = {:id} && organization = {:org}", {
            id: t.id,
            org: t.orgId,
          }),
          { fields: "id,status" },
        )
        .catch(() => null),
    );
    if (row && str(row.status) === "held") {
      extra.push({
        collection: "media_assets",
        id: row.id,
        body: { status: "ready" },
      });
    }
  }
  const flagIds = await withSuperuser((pb) => openFlagIds(pb, t));
  return { flagIds, extra };
}

/** Take a page offline (case outcome "removed"): its live slugs leave the manifest (404). */
async function takePageOffline(
  ctx: PlatformContext,
  t: Target,
  opts: ReviewOutcomeOptions,
): Promise<void> {
  const store: ObjectStore = opts.content?.store ?? getObjectStore();
  const now = validNow(opts.now);
  await withOrgLock(t.orgId, () =>
    withSuperuser(async (pb) => {
      const page = await pb
        .collection("pages")
        .getFirstListItem(
          pb.filter("id = {:id} && organization = {:org}", {
            id: t.id,
            org: t.orgId,
          }),
          { fields: "id,status,slug" },
        )
        .catch(() => {
          throw new NotFound();
        });
      const manifestKey = tenantSiteManifestKey(t.orgId);
      const manifest = await readManifest(store, t.orgId, now);
      const live = Object.entries(manifest.pages)
        .filter(([, e]) => e.id === page.id)
        .map(([s]) => s);
      const prev = live.length > 0 ? await store.get(manifestKey) : null;
      if (live.length > 0) {
        for (const s of live) {
          delete manifest.pages[s];
          delete manifest.redirects[s];
        }
        manifest.updated_at = now.toISOString();
        await store.put(manifestKey, JSON.stringify(manifest), JSON_TYPE);
      }
      try {
        const batch = pb.createBatch();
        batch.collection("pages").update(page.id, {
          status: "draft",
          has_unpublished_changes: true,
        });
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action: "page.unpublished_by_cds",
            organization: t.orgId,
            targetCollection: "pages",
            targetId: page.id,
            meta: { slug: str(page.slug), live: live.length > 0 },
          }),
        );
        await batch.send();
      } catch (err) {
        if (live.length > 0) {
          if (prev) await store.put(manifestKey, prev, JSON_TYPE);
          else await store.delete(manifestKey).catch(() => undefined);
        }
        throw err;
      }
    }),
  );
  await refreshSiteIndex(t.orgId, {
    ...(opts.content?.sections ? { sections: opts.content.sections } : {}),
    store,
    now: () => now,
  });
  const inv = opts.content?.invalidator ?? opts.invalidator;
  try {
    inv?.invalidate([
      pageTag(t.orgId, t.id),
      siteTag(t.orgId),
      liveTag(t.orgId),
    ]);
  } catch (err) {
    console.error(`[review] cache invalidate failed ${errName(err)}`);
  }
}

async function removeTarget(
  ctx: PlatformContext,
  t: Target,
  ref: string,
  opts: ReviewOutcomeOptions,
): Promise<string[]> {
  if (t.collection === "pages") {
    await takePageOffline(ctx, t, opts);
  } else if (t.collection === "media_assets") {
    if (!opts.media) throw new InvalidInput("A takedown needs the media deps.");
    try {
      await takedownMedia(
        ctx,
        {
          orgId: t.orgId,
          assetId: t.id,
          reason: opts.reason?.trim() || `Review ${ref}`,
        },
        opts.media,
      );
    } catch (err) {
      // WR-A05: a retry finds the file already taken down; removed is what was asked.
      if (!(err instanceof NotFound)) throw err;
    }
  } else {
    throw new InvalidInput(
      "Only a page or a media file can be removed from the review queue.",
    );
  }
  return withSuperuser((pb) => openFlagIds(pb, t));
}

// The suspension module's refusals when the state an outcome asks for is already there
// (staff/suspension.ts). Matched so a retried outcome completes instead of failing (WR-A05).
const SUSPENDED_MSG = "This site is already suspended.";
const NOTICE_OPEN_MSG = "This site already has an open notice.";

function isAlready(err: unknown, message: string): boolean {
  return err instanceof InvalidInput && err.message === message;
}

/**
 * Runs the side effect of one outcome; returns flags to resolve and extra record updates.
 * Callers validate their own input first: this is the step that changes the site.
 */
async function applyOutcome(
  ctx: PlatformContext,
  outcome: ReviewOutcome,
  ref: string,
  kind: ReviewCaseKind | "flag",
  orgId: string,
  target: Target | null,
  opts: ReviewOutcomeOptions,
): Promise<{
  flagIds: string[];
  extra: { collection: string; id: string; body: Record<string, unknown> }[];
}> {
  const none = {
    flagIds: [] as string[],
    extra: [] as {
      collection: string;
      id: string;
      body: Record<string, unknown>;
    }[],
  };
  const deps = {
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.transport ? { transport: opts.transport } : {}),
    ...(opts.invalidator ? { invalidator: opts.invalidator } : {}),
  };
  switch (outcome) {
    case "cleared":
      return target ? clearTarget(ctx, target, opts) : none;
    case "fix_requested": {
      if (!orgId) throw new InvalidInput("This case has no site to notify.");
      try {
        await staffSendSuspensionNotice(
          ctx,
          {
            orgId,
            category: kind === "dmca" ? "dmca" : "guideline",
            message: opts.message ?? "",
            ...(opts.note ? { note: opts.note } : {}),
          },
          deps,
        );
      } catch (err) {
        // WR-A05: a retry after a failed case write finds the notice already open.
        if (!isAlready(err, NOTICE_OPEN_MSG)) throw err;
      }
      return none;
    }
    case "removed": {
      if (!target)
        throw new InvalidInput("This case has no page or file to remove.");
      return { flagIds: await removeTarget(ctx, target, ref, opts), extra: [] };
    }
    case "suspended": {
      if (!orgId) throw new InvalidInput("This case has no site to suspend.");
      try {
        await staffSuspendNow(
          ctx,
          {
            orgId,
            category:
              opts.suspendCategory ?? (kind === "dmca" ? "dmca" : "illegal"),
            note: opts.note ?? `Review ${ref}`,
            ...(opts.message ? { message: opts.message } : {}),
          },
          deps,
        );
      } catch (err) {
        // WR-A05: already offline is what this outcome asks for.
        if (!isAlready(err, SUSPENDED_MSG)) throw err;
      }
      return none;
    }
    default:
      return none;
  }
}

function outcomeAllowed(
  outcome: unknown,
  kind: ReviewCaseKind | "flag",
): ReviewOutcome {
  if (
    typeof outcome !== "string" ||
    !(REVIEW_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    throw new InvalidInput("unknown outcome");
  }
  const o = outcome as ReviewOutcome;
  if ((o === "upheld" || o === "restored") && kind !== "dmca") {
    throw new InvalidInput("That outcome is for copyright (DMCA) cases.");
  }
  if (o === "rejected" && (kind === "flag" || kind === "spot_check")) {
    throw new InvalidInput("Reject is for reports and DMCA notices.");
  }
  return o;
}

/**
 * Apply an outcome to a case (`review_queue`; removed media and suspended are refused inside
 * takedownMedia / staffSuspendNow unless super_admin). The side effect runs first; then one
 * batch: the case update, resolved flags, released holds and the `review.outcome` audit row.
 */
export async function staffCaseOutcome(
  ctx: PlatformContext,
  ref: string,
  outcome: ReviewOutcome,
  opts: ReviewOutcomeOptions = {},
): Promise<ReviewOutcomeResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "review_queue");
  const now = validNow(opts.now);
  const row = await withSuperuser((pb) => loadCase(pb, ref));
  const kind = str(row.kind) as ReviewCaseKind;
  const o = outcomeAllowed(outcome, kind);
  const code = reviewCaseRef(Number(row.seq) || 0);
  const closed = (r: RecordModel) =>
    str(r.status) === "closed" || lastStep(stepsOf(r.steps))?.step === "closed";
  if (closed(row)) throw new InvalidInput("This case is closed.");
  // WR-A05: validate everything before the side effect, so a bad note or a missing
  // precondition never leaves the site changed and the case unchanged.
  const note = textOf(opts.note, "note", REVIEW_NOTE_MAX, false);
  if (
    o === "restored" &&
    !stepsOf(row.steps).some((e) => e.step === "restore_date_set")
  ) {
    throw new InvalidInput("Set the restore date first.");
  }
  const orgId = str(row.org_id);
  const target =
    orgId && str(row.target_collection) && ID_RE.test(str(row.target_id))
      ? {
          orgId,
          collection: str(row.target_collection),
          id: str(row.target_id),
        }
      : null;
  const { flagIds, extra } = await applyOutcome(
    ctx,
    o,
    code,
    kind,
    orgId,
    target,
    {
      ...opts,
      now,
    },
  );

  await withSuperuser(async (pb) => {
    // Timeline + status from the case as it is now (a step added meanwhile is kept).
    const fresh = await loadCase(pb, ref);
    const steps = stepsOf(fresh.steps);
    const add = (step: ReviewCaseStep) => {
      const last = lastStep(steps);
      if (!last || STEP_RANK[step] > STEP_RANK[last.step]) {
        steps.push({
          step,
          at: now.toISOString(),
          by: ctx.actor,
          ...(note ? { note } : {}),
        });
      }
    };
    let status = (str(fresh.status) || "open") as ReviewCaseStatus;
    if (o === "removed" || o === "suspended") add("content_disabled");
    if (o === "fix_requested") {
      add("tenant_notified");
      status = "waiting";
    }
    if (o === "upheld" || o === "restored") {
      add(o);
      status = "open";
    }
    if (o === "cleared" || o === "rejected") {
      add("closed");
      status = "closed";
    }
    const batch = pb.createBatch();
    batch.collection(CASES).update(row.id, { outcome: o, steps, status });
    for (const id of flagIds)
      batch.collection(FLAGS).update(id, { status: "resolved" });
    for (const e of extra) batch.collection(e.collection).update(e.id, e.body);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "review.outcome",
        organization: orgId || null,
        targetCollection: CASES,
        targetId: row.id,
        meta: { ref: code, outcome: o },
      }),
    );
    await batch.send();
  });
  return {
    ref: code,
    outcome: o,
    orgId: orgId || null,
    flagsResolved: flagIds.length,
  };
}

/**
 * Choice 3: act on a scan flag or hold straight from the queue (no case row). The flag's
 * target gets the outcome; every open flag on that target resolves (fix_requested and
 * suspended resolve the flag too: staff decided). Audited `review.outcome` (meta ref = flag id).
 */
export async function staffResolveFlag(
  ctx: PlatformContext,
  flagId: string,
  outcome: ReviewFlagOutcome,
  opts: ReviewOutcomeOptions = {},
): Promise<ReviewOutcomeResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "review_queue");
  const now = validNow(opts.now);
  if (typeof flagId !== "string" || !ID_RE.test(flagId)) throw new NotFound();
  const o = outcomeAllowed(outcome, "flag");
  const flag = await withSuperuser((pb) =>
    pb
      .collection(FLAGS)
      .getOne(flagId)
      .catch(() => {
        throw new NotFound();
      }),
  );
  if (str(flag.status) === "resolved") {
    throw new InvalidInput("This flag is already handled.");
  }
  const orgId = str(flag.organization);
  const target: Target = {
    orgId,
    collection: str(flag.target_collection),
    id: str(flag.target_id),
  };
  const res = await applyOutcome(ctx, o, flagId, "flag", orgId, target, {
    ...opts,
    now,
  });
  const ids = new Set(res.flagIds);
  ids.add(flagId);
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    for (const id of ids)
      batch.collection(FLAGS).update(id, { status: "resolved" });
    for (const e of res.extra)
      batch.collection(e.collection).update(e.id, e.body);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "review.outcome",
        organization: orgId || null,
        targetCollection: FLAGS,
        targetId: flagId,
        meta: { ref: flagId, outcome: o },
      }),
    );
    await batch.send();
  });
  return {
    ref: flagId,
    outcome: o,
    orgId: orgId || null,
    flagsResolved: ids.size,
  };
}

// ---------------------------------------------------------------------------------------
// Repeat infringers (P13-P25)

function upheldAt(r: RecordModel): number {
  const step = stepsOf(r.steps).find((e) => e.step === "upheld");
  const t = Date.parse(step?.at || str(r.updated));
  return Number.isFinite(t) ? t : 0;
}

async function upheldRows(
  orgIds: readonly string[] | null,
): Promise<RecordModel[]> {
  return withSuperuser((pb) => {
    let filter = "kind = 'dmca' && outcome = 'upheld'";
    if (orgIds) {
      const parts = orgIds.map((id, i) =>
        pb.filter("org_id = {:o" + i + "}", { ["o" + i]: id }),
      );
      filter += ` && (${parts.join(" || ")})`;
    }
    return pb
      .collection(CASES)
      .getFullList({ filter, fields: "org_id,steps,updated" });
  });
}

function countRepeat(rows: RecordModel[], now: Date): Set<string> {
  const since = now.getTime() - REPEAT_INFRINGER_WINDOW_DAYS * DAY_MS;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const org = str(r.org_id);
    if (!org) continue;
    const at = upheldAt(r);
    if (at < since || at > now.getTime()) continue;
    counts.set(org, (counts.get(org) ?? 0) + 1);
  }
  return new Set(
    [...counts].filter(([, n]) => n >= REPEAT_INFRINGER_UPHELD).map(([o]) => o),
  );
}

/** Every org with >= 3 upheld DMCA cases in the trailing 365 days (internal read; flag only). */
export async function repeatInfringers(
  now: Date = new Date(),
): Promise<Set<string>> {
  return countRepeat(await upheldRows(null), validNow(now));
}

/** The repeat-infringer subset of `orgIds` (13-33 Sites list join). */
export async function repeatInfringerFor(
  orgIds: readonly string[],
  opts: { now?: Date } = {},
): Promise<Set<string>> {
  const ids = [...new Set(orgIds)].filter(
    (id) => typeof id === "string" && ID_RE.test(id),
  );
  if (ids.length === 0) return new Set();
  return countRepeat(await upheldRows(ids), validNow(opts.now));
}
