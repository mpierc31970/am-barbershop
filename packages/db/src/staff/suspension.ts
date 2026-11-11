// packages/db/src/staff/suspension.ts (13-17; STAFF-22, D215, D218, P13-P3, Invariant 9).
// Site suspension in the data layer. Four staff steps and one job:
// - staffSendSuspensionNotice (`suspend_notice`, both roles): 3 calendar days to fix (D215).
// - staffSuspendNow (`suspend_now`, super_admin): the site goes offline at once.
// - staffMarkFixed (`suspend_notice`): the open notice ends; nothing goes offline.
// - staffLiftSuspension (`suspend_lift`, super_admin): back online at once.
// - jobAutoSuspend (review:run, 13-29): notices whose fix-by passed unfixed go offline.
// Suspension is `organizations.suspended_at` + the staff-only `suspension` json, never a
// status value (P13-P3). Nothing is deleted (Invariant 9). Each step is one batch: the org
// update, the CDS note the owner reads in CDS Support and an audit row the tenant sees (meta
// `{ mode, category }`, never the staff note). After commit, best effort: the owner email to
// Owners and Admins and the urgent `site.suspension_notice` alert (its generic email skipped,
// the dedicated one went). Side-effect failures are logged by class name, never undo state.
// Suspend and lift clear the resolver cache, the orgIsLive entry and the site's cache tags.
// Every step re-reads the org and re-checks its state under one per-org lock
// (`withSuspensionLock`) right before its commit, so a staff step and the auto-suspend job,
// or two staff clicks, never both act on a stale read (review WR-A06).
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { fillCopy, P13_COPY } from "@cds/core/staff";
import type PocketBase from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { liveTag, siteTag, type Invalidator } from "../content/ports";
import {
  assertOrgContext,
  assertPlatformContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { forgetOrgLive } from "../org-stage";
import { clearResolverCache } from "../resolve";
import { newRecordId } from "../repository";
import { CONVERSATION_HREF } from "../support/messages";
import { errName, staffFirstName } from "../support/shared";

// The middleware's suspension read (13-22) reaches the root barrel through `staff/index.ts`.
export { isHostSuspended } from "../resolve";

/** Calendar days a notice gives the owner to fix (D215). */
export const SUSPENSION_NOTICE_DAYS = 3;
/** Staff note and owner message limit (UI-SPEC: What to fix, 1,000). */
export const SUSPENSION_TEXT_MAX = 1000;

export const SUSPENSION_CATEGORIES = [
  "illegal",
  "legal_demand",
  "guideline",
  "dmca",
] as const;
export type SuspensionCategory = (typeof SUSPENSION_CATEGORIES)[number];

/** Owner-facing reason labels (owner email "Reason: …"). */
export const SUSPENSION_CATEGORY_LABELS: Readonly<
  Record<SuspensionCategory, string>
> = Object.freeze({
  illegal: "Illegal content",
  legal_demand: "Legal demand",
  guideline: "Hosting rules",
  dmca: "Copyright claim",
});

const IMMEDIATE_CATEGORIES: ReadonlySet<SuspensionCategory> = new Set([
  "illegal",
  "legal_demand",
  "dmca",
]);
const NOTICE_CATEGORIES: ReadonlySet<SuspensionCategory> = new Set([
  "guideline",
  "dmca",
]);

export type SuspensionMode = "immediate" | "notice" | "notice_expired";

/** The tenant read (hub `SuspensionNotice`): state and dates only, never note or category. */
export type SuspensionStatus = {
  state: "none" | "notice" | "suspended";
  fixBy?: string;
  suspendedAt?: string;
};

export type SuspensionDeps = {
  now?: Date;
  transport?: EmailTransport;
  /** The site cache invalidator (apps/web passes `nextInvalidator`); default none. */
  invalidator?: Invalidator;
};

export type SuspensionStepResult = {
  orgId: string;
  /** ISO; notice only. */
  fixBy?: string;
  /** ISO; suspend only. */
  suspendedAt?: string;
  /** Owner and Admin emails sent. */
  emailed: number;
  /** Alert bell rows raised. */
  alerted: number;
};

export type SuspensionStepInput = {
  orgId: string;
  category: string;
  /** Staff-only note (never shown to the tenant). */
  note?: string;
  /** What the owner reads (email + CDS note). Required for a notice. */
  message?: string;
  now?: Date;
};

const ORGS = "organizations";
const NOTES = "cds_notes";
const ORG_ID_RE = /^[a-z0-9]{15}$/;
const ORG_FIELDS = "id,name,status,suspended_at,suspension";
const AUTO_SUSPEND_MAX = 500;

type Suspension = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function suspensionOf(v: unknown): Suspension | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Suspension)
    : null;
}

/** PocketBase dates ("2026-10-12 15:00:00.000Z") and ISO strings, as epoch ms (NaN if bad). */
function msOf(v: unknown): number {
  const s = str(v);
  if (s === "") return Number.NaN;
  return Date.parse(s.includes(" ") ? s.replace(" ", "T") : s);
}

function isoOf(v: unknown): string | undefined {
  const ms = msOf(v);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function validNow(now: Date | undefined): Date {
  const d = now ?? new Date();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  return d;
}

function assertOrgId(v: unknown): string {
  if (typeof v !== "string" || !ORG_ID_RE.test(v)) throw new NotFound();
  return v;
}

function categoryOf(
  v: unknown,
  allowed: ReadonlySet<SuspensionCategory>,
): SuspensionCategory {
  if (
    typeof v !== "string" ||
    !(SUSPENSION_CATEGORIES as readonly string[]).includes(v) ||
    !allowed.has(v as SuspensionCategory)
  ) {
    throw new InvalidInput(
      `category must be one of ${[...allowed].join(", ")}`,
    );
  }
  return v as SuspensionCategory;
}

function textOf(v: unknown, what: string, required: boolean): string {
  if (v !== undefined && v !== null && typeof v !== "string") {
    throw new InvalidInput(`${what} must be text`);
  }
  const t = str(v).trim();
  if (required && t === "") throw new InvalidInput(`${what} is required`);
  if (t.length > SUSPENSION_TEXT_MAX) {
    throw new InvalidInput(
      `${what} must be at most ${SUSPENSION_TEXT_MAX} characters`,
    );
  }
  return t;
}

/** Offset of America/Chicago from UTC at `at`, in ms (negative in the US). */
function chicagoOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(
    n("year"),
    n("month") - 1,
    n("day"),
    n("hour"),
    n("minute"),
    n("second"),
  );
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * `days` calendar days later at the same America/Chicago wall time (D215), so a notice sent
 * at 5:00 pm is due at 5:00 pm three days later even across a DST change.
 */
export function suspensionFixBy(
  now: Date,
  days = SUSPENSION_NOTICE_DAYS,
): Date {
  const naive = new Date(now.getTime() + days * 86_400_000);
  return new Date(
    naive.getTime() + chicagoOffsetMs(now) - chicagoOffsetMs(naive),
  );
}

function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    day: "numeric",
    month: "short",
  })
    .format(d)
    .replace(/^(\w+) (\d+)$/, "$2 $1");
}

function fixByWords(d: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Chicago",
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(d)
    .replace(",", "");
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(d)
    .replace(/\s?([AP])M$/, (_m, ap: string) => ` ${ap.toLowerCase()}m`);
  return `${day}, ${time}`;
}

type OrgRow = {
  id: string;
  name: string;
  suspendedAt: string;
  suspension: Suspension | null;
};

async function loadOrg(pb: PocketBase, orgId: string): Promise<OrgRow> {
  const row = await pb
    .collection(ORGS)
    .getOne(orgId, { fields: ORG_FIELDS })
    .catch(() => {
      throw new NotFound();
    });
  return {
    id: row.id,
    name: str(row.name) || "your site",
    suspendedAt: str(row.suspended_at),
    suspension: suspensionOf(row.suspension),
  };
}

/** One suspension step per org at a time: read, check and commit run inside (WR-A06). */
function withSuspensionLock<T>(
  orgId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withOrgLock(`suspension:${orgId}`, fn);
}

function noticeOpen(s: Suspension | null): boolean {
  return (
    s !== null &&
    s.mode === "notice" &&
    str(s.fixed_at) === "" &&
    str(s.lifted_at) === ""
  );
}

type Actor =
  | { kind: "staff"; ctx: PlatformContext }
  | { kind: "system"; ctx: SystemContext };

async function authorName(pb: PocketBase, who: Actor): Promise<string> {
  return who.kind === "staff" ? staffFirstName(pb, who.ctx.actor) : "CDS";
}

type Step = {
  orgId: string;
  patch: Record<string, unknown>;
  action:
    | "site.suspension_notice_sent"
    | "site.suspended"
    | "site.suspension_fixed"
    | "site.suspension_lifted";
  meta: { mode: string; category: string };
  note: { title: string; body: string } | null;
};

/** One batch: org update, optional CDS note, audit row (tenant-visible, no note text). */
async function commit(pb: PocketBase, who: Actor, step: Step): Promise<void> {
  const batch = pb.createBatch();
  batch.collection(ORGS).update(step.orgId, step.patch);
  if (step.note) {
    batch.collection(NOTES).create({
      id: newRecordId(),
      organization: step.orgId,
      title: step.note.title,
      body: step.note.body,
      pinned: false,
      created_by: who.kind === "staff" ? who.ctx.actor : "",
      author_name: await authorName(pb, who),
      removed_at: "",
    });
  }
  batch.collection("audit_log").create(
    auditBody(who.ctx, {
      action: step.action,
      organization: step.orgId,
      targetCollection: ORGS,
      targetId: step.orgId,
      meta: step.meta,
    }),
  );
  await batch.send();
}

/** Owners' and Admins' addresses (the suspension mail goes to the people who can act). */
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

type Mail =
  | { type: "site.suspension_notice"; fixBy: Date; whatToFix: string }
  | { type: "site.suspended"; suspendedAt: Date; reasonLabel: string }
  | { type: "site.suspension_lifted" };

/** After commit, best effort: owner mail + the urgent alert. Never throws. */
async function notify(
  org: OrgRow,
  mail: Mail,
  alert: { title: string; safeTitle: string },
  deps: SuspensionDeps,
  now: Date,
): Promise<{ emailed: number; alerted: number }> {
  let emailed = 0;
  const sender = {
    kind: "cds" as const,
    ctx: mintSystemContext({ job: "suspension" }),
  };
  const href = platformUrl(CONVERSATION_HREF);
  const opts = {
    concernsOrg: org.id,
    now,
    ...(deps.transport ? { transport: deps.transport } : {}),
  };
  try {
    const to = await withSuperuser((pb) => ownerAdminEmails(pb, org.id));
    for (const addr of to) {
      try {
        if (mail.type === "site.suspension_notice") {
          await sendEmail(
            sender,
            mail.type,
            addr,
            {
              business: org.name,
              fixBy: mail.fixBy,
              whatToFix: mail.whatToFix,
              href,
            },
            opts,
          );
        } else if (mail.type === "site.suspended") {
          await sendEmail(
            sender,
            mail.type,
            addr,
            {
              business: org.name,
              suspendedAt: mail.suspendedAt,
              reasonLabel: mail.reasonLabel,
              href,
            },
            opts,
          );
        } else {
          await sendEmail(
            sender,
            mail.type,
            addr,
            { business: org.name, href: platformUrl("/hub") },
            opts,
          );
        }
        emailed += 1;
      } catch (err) {
        console.error(`[suspension] owner email failed ${errName(err)}`);
      }
    }
  } catch (err) {
    console.error(`[suspension] owner lookup failed ${errName(err)}`);
  }
  // raiseAlert never throws; its generic email is skipped (the dedicated one went above).
  const r = await raiseAlert(
    { orgId: org.id, as: mintSystemContext({ job: "suspension" }) },
    {
      type: "site.suspension_notice",
      sourceKey: "suspension",
      title: alert.title,
      safeTitle: alert.safeTitle,
      href: CONVERSATION_HREF,
      actionLabel: "Open Support",
      at: now,
    },
    {
      now,
      dedicatedEmail: true,
      renotify: true,
      ...(deps.transport ? { transport: deps.transport } : {}),
    },
  );
  return { emailed, alerted: r.recipients };
}

/** Suspend and lift: the public host must change on the next request (Pitfall 6). */
function invalidate(orgId: string, deps: SuspensionDeps): void {
  clearResolverCache();
  forgetOrgLive(orgId);
  try {
    deps.invalidator?.invalidate([siteTag(orgId), liveTag(orgId)]);
  } catch (err) {
    console.error(`[suspension] cache invalidate failed ${errName(err)}`);
  }
}

function suspendedNoteBody(
  message: string,
  at: Date,
  reasonLabel: string,
): string {
  const lead = fillCopy(P13_COPY.SUSP_OFFLINE, { date: shortDate(at) });
  return [lead, `Reason: ${reasonLabel}`, message, P13_COPY.MAIL_MISTAKE_LINE]
    .filter((l) => l !== "")
    .join("\n\n");
}

type SuspendInput = {
  mode: SuspensionMode;
  category: SuspensionCategory;
  note: string;
  message: string;
  prior: Suspension | null;
};

/**
 * Take a site offline. `decide` sees the org as re-read under the suspension lock and
 * returns the input, null to skip (nothing written, null returned), or throws (WR-A06).
 */
async function suspend(
  who: Actor,
  orgId: string,
  decide: (org: OrgRow) => SuspendInput | null,
  deps: SuspensionDeps,
  now: Date,
): Promise<SuspensionStepResult | null> {
  const at = now.toISOString();
  const done = await withSuspensionLock(orgId, () =>
    withSuperuser(async (pb) => {
      const org = await loadOrg(pb, orgId);
      const input = decide(org);
      if (!input) return null;
      const reasonLabel = SUSPENSION_CATEGORY_LABELS[input.category];
      const suspension: Suspension = {
        mode: input.mode,
        category: input.category,
        note: input.note,
        ...(input.message ? { message: input.message } : {}),
        by: who.kind === "staff" ? who.ctx.actor : "system",
        at,
      };
      if (input.mode === "notice_expired" && input.prior) {
        suspension.notice_sent_at = str(input.prior.notice_sent_at);
        suspension.fix_by = str(input.prior.fix_by);
      }
      await commit(pb, who, {
        orgId: org.id,
        patch: { suspended_at: at, suspension },
        action: "site.suspended",
        meta: { mode: input.mode, category: input.category },
        note: {
          title: "Site offline",
          body: suspendedNoteBody(input.message, now, reasonLabel),
        },
      });
      return { org, reasonLabel };
    }),
  );
  if (!done) return null;
  const { org, reasonLabel } = done;
  invalidate(org.id, deps);
  const n = await notify(
    org,
    { type: "site.suspended", suspendedAt: now, reasonLabel },
    { title: "Your site is offline.", safeTitle: "Your site is offline" },
    deps,
    now,
  );
  return { orgId: org.id, suspendedAt: at, ...n };
}

/**
 * Send a notice to fix (`suspend_notice`, both roles): `fix_by` = 3 calendar days later
 * (America/Chicago wall time). Refused when the site is suspended or a notice is open.
 * `message` (what to fix) is what the owner reads; `note` stays staff-only.
 */
export async function staffSendSuspensionNotice(
  ctx: PlatformContext,
  input: SuspensionStepInput,
  deps: SuspensionDeps = {},
): Promise<SuspensionStepResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "suspend_notice");
  const orgId = assertOrgId(input?.orgId);
  const category = categoryOf(input.category, NOTICE_CATEGORIES);
  const message = textOf(input.message, "what to fix", true);
  const note = textOf(input.note, "note", false);
  const now = validNow(input.now ?? deps.now);
  const who: Actor = { kind: "staff", ctx };
  const fixBy = suspensionFixBy(now);

  const org = await withSuspensionLock(orgId, () =>
    withSuperuser(async (pb) => {
      const row = await loadOrg(pb, orgId);
      if (row.suspendedAt !== "") {
        throw new InvalidInput("This site is already suspended.");
      }
      if (noticeOpen(row.suspension)) {
        throw new InvalidInput("This site already has an open notice.");
      }
      const when = fixByWords(fixBy);
      await commit(pb, who, {
        orgId,
        patch: {
          suspension: {
            mode: "notice",
            category,
            note,
            message,
            notice_sent_at: now.toISOString(),
            fix_by: fixBy.toISOString(),
            by: ctx.actor,
          },
        },
        action: "site.suspension_notice_sent",
        meta: { mode: "notice", category },
        note: {
          title: "Hosting rules notice",
          body: [
            fillCopy(P13_COPY.SUSP_NOTICE, { when }),
            message,
            P13_COPY.MAIL_MISTAKE_LINE,
          ].join("\n\n"),
        },
      });
      return row;
    }),
  );
  const n = await notify(
    org,
    { type: "site.suspension_notice", fixBy, whatToFix: message },
    {
      title:
        "Support found something on your site that breaks the hosting rules",
      safeTitle: "Action needed on your site",
    },
    deps,
    now,
  );
  return { orgId, fixBy: fixBy.toISOString(), ...n };
}

/**
 * Suspend now (`suspend_now`, super_admin; step-up is the console's gate): illegal content,
 * a legal demand or a copyright claim. `note` (staff-only) is required; `message` is added to
 * the owner's CDS note. Allowed while a notice is open (it replaces it).
 */
export async function staffSuspendNow(
  ctx: PlatformContext,
  input: SuspensionStepInput,
  deps: SuspensionDeps = {},
): Promise<SuspensionStepResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "suspend_now");
  const orgId = assertOrgId(input?.orgId);
  const category = categoryOf(input.category, IMMEDIATE_CATEGORIES);
  const note = textOf(input.note, "note", true);
  const message = textOf(input.message, "message to the owner", false);
  const now = validNow(input.now ?? deps.now);
  const res = await suspend(
    { kind: "staff", ctx },
    orgId,
    (org) => {
      if (org.suspendedAt !== "") {
        throw new InvalidInput("This site is already suspended.");
      }
      return {
        mode: "immediate",
        category,
        note,
        message,
        prior: org.suspension,
      };
    },
    deps,
    now,
  );
  if (!res) throw new InvalidInput("This site is already suspended.");
  return res;
}

/**
 * Mark an open notice fixed (`suspend_notice`): stamps `fixed_at`; nothing goes offline and
 * jobAutoSuspend skips it. The owner is told (CDS note); no email, no alert.
 */
export async function staffMarkFixed(
  ctx: PlatformContext,
  orgId: string,
  opts: { now?: Date } = {},
): Promise<{ orgId: string; fixedAt: string }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "suspend_notice");
  const id = assertOrgId(orgId);
  const now = validNow(opts.now);
  const at = now.toISOString();
  await withSuspensionLock(id, () =>
    withSuperuser(async (pb) => {
      const row = await loadOrg(pb, id);
      if (row.suspendedAt !== "" || !noticeOpen(row.suspension)) {
        throw new InvalidInput("This site has no open notice.");
      }
      const s = row.suspension ?? {};
      await commit(
        pb,
        { kind: "staff", ctx },
        {
          orgId: id,
          patch: { suspension: { ...s, fixed_at: at } },
          action: "site.suspension_fixed",
          meta: { mode: "notice", category: str(s.category) },
          note: {
            title: "Hosting rules notice closed",
            body: "Thanks. Support checked your site and the notice is closed. Nothing else to do.",
          },
        },
      );
    }),
  );
  return { orgId: id, fixedAt: at };
}

/** Lift a suspension (`suspend_lift`, super_admin): back online at once, caches cleared. */
export async function staffLiftSuspension(
  ctx: PlatformContext,
  orgId: string,
  deps: SuspensionDeps = {},
): Promise<{
  orgId: string;
  liftedAt: string;
  emailed: number;
  alerted: number;
}> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "suspend_lift");
  const id = assertOrgId(orgId);
  const now = validNow(deps.now);
  const at = now.toISOString();
  const org = await withSuspensionLock(id, () =>
    withSuperuser(async (pb) => {
      const row = await loadOrg(pb, id);
      if (row.suspendedAt === "") {
        throw new InvalidInput("This site is not suspended.");
      }
      const s = row.suspension ?? {};
      await commit(
        pb,
        { kind: "staff", ctx },
        {
          orgId: id,
          patch: { suspended_at: "", suspension: { ...s, lifted_at: at } },
          action: "site.suspension_lifted",
          meta: { mode: str(s.mode), category: str(s.category) },
          note: { title: "Site back online", body: P13_COPY.MAIL_BACK_ONLINE },
        },
      );
      return row;
    }),
  );
  invalidate(id, deps);
  const n = await notify(
    org,
    { type: "site.suspension_lifted" },
    {
      title: "Your site is back online.",
      safeTitle: "Your site is back online",
    },
    deps,
    now,
  );
  return { orgId: id, liftedAt: at, ...n };
}

/**
 * review:run step (13-29): every org with an open notice (`mode = notice`, no `fixed_at`, not
 * lifted) whose `fix_by <= now` and that is not suspended goes offline with mode
 * `notice_expired`, by `system`, with the same notifications. One failure never stops the rest.
 */
export async function jobAutoSuspend(
  now: Date = new Date(),
  deps: Omit<SuspensionDeps, "now"> = {},
): Promise<{ suspended: number; failed: number }> {
  const at = validNow(now);
  const sys = mintSystemContext({ job: "auto-suspend" });
  const candidates = await withSuperuser((pb) =>
    pb.collection(ORGS).getFullList({
      filter: "suspended_at = ''",
      fields: ORG_FIELDS,
      batch: AUTO_SUSPEND_MAX,
    }),
  );
  let suspended = 0;
  let failed = 0;
  // The list is a first pass only: each org is re-read and re-checked under the lock, so a
  // notice marked fixed (or a site suspended by staff) since the list was read is skipped.
  const due = (s: Suspension | null): s is Suspension => {
    if (!noticeOpen(s)) return false;
    const fixBy = msOf(s?.fix_by);
    return !Number.isNaN(fixBy) && fixBy <= at.getTime();
  };
  for (const row of candidates) {
    if (!due(suspensionOf(row.suspension))) continue;
    try {
      const res = await suspend(
        { kind: "system", ctx: sys },
        row.id,
        (org) => {
          const s = org.suspension;
          if (org.suspendedAt !== "" || !due(s)) return null;
          const category = str(s.category);
          const cat = (SUSPENSION_CATEGORIES as readonly string[]).includes(
            category,
          )
            ? (category as SuspensionCategory)
            : "guideline";
          return {
            mode: "notice_expired",
            category: cat,
            note: str(s.note),
            message: str(s.message),
            prior: s,
          };
        },
        deps,
        at,
      );
      if (res) suspended += 1;
    } catch (err) {
      failed += 1;
      console.error(`[suspension] auto-suspend failed ${errName(err)}`);
    }
  }
  return { suspended, failed };
}

/** The hub notice read (any member of the org): state and dates only. */
export async function suspensionStatusFor(
  ctx: OrgContext,
): Promise<SuspensionStatus> {
  assertOrgContext(ctx);
  const row = await withSuperuser((pb) =>
    pb
      .collection(ORGS)
      .getOne(ctx.orgId, { fields: "id,suspended_at,suspension" })
      .catch(() => {
        throw new NotFound();
      }),
  );
  const suspendedAt = isoOf(row.suspended_at);
  if (suspendedAt) return { state: "suspended", suspendedAt };
  const s = suspensionOf(row.suspension);
  if (noticeOpen(s)) {
    const fixBy = isoOf(s?.fix_by);
    return fixBy ? { state: "notice", fixBy } : { state: "notice" };
  }
  return { state: "none" };
}
