// packages/db/src/offboarding/offboardings.ts (P14, LIFE-01; D282, D263, D161, D293).
// Owner: 14-39 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Leaving CDS, the record (14-39 choices 1, 2, 5b, 7):
//   - One `offboardings` row per org (org_id unique; a cancelled row is re-opened). Started by
//     the Owner (`offboarding:run`, deny-listed under impersonation, plus an emailed code) or a
//     super_admin (`offboard`, reason 3-500; the console enforces step-up). 30-day notice.
//   - Org scoping (P14-P34): every function resolves its org with scopedOrgId(ctx, orgId); an
//     OrgContext naming another org is NotFound.
//   - DNS first (D282): `dns_handback` is open when the org has a delegated zone (`active` or
//     `moved`), else not applicable and the later steps open at once. An open, undelegated
//     move is cancelled at start (its pending zone deleted only when provably unused; a
//     zone the domain already points at is kept and counted as delegated, CR-A01).
//   - advanceOffboardings (the domains:run `offboarding` step, 14-41) closes due notices, or
//     keeps an overdue one open while the DNS is still at CDS (P14-P36).
import { createHash } from "node:crypto";
import { can, Forbidden, InvalidInput, NotFound } from "@cds/core";
import { NEEDS_YOU, P14_COPY } from "@cds/core/dns";
import { maskEmail } from "@cds/core/staff";
import type { NeedsYouItem } from "@cds/core/today";
import { ClientResponseError } from "pocketbase";
import { auditBody } from "../audit";
import { guestClient, withSuperuser } from "../client";
import {
  assertOrgContext,
  isOrgContext,
  isPlatformContext,
  scopedOrgId,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { getDnsProvider } from "../dns/factory";
import { cancelMove, openMoveFor, zoneMayServe } from "../dns/moves";
import { beginSignIn } from "../rate-limit";
import { newRecordId, requirePermission } from "../repository";
import {
  alertStaffDomain,
  delegatedZones,
  endBillingForOffboarding,
  errName,
  LEAVING_HREF,
  notifyOwners,
  orgFacts,
  sysCtx,
  type OffboardingDeps,
} from "./effects";
import {
  daysLeft,
  DAY_MS,
  handbackSettled,
  initialSteps,
  NOTICE_DAYS,
  noticeEnd,
  OFFBOARDING_REASON_CATEGORIES,
  OFFBOARDINGS,
  OVERDUE_REMINDER_DAYS,
  readOffboardingRow,
  toOffboardingRow,
  type OffboardingOwnerStep,
  type OffboardingReasonCategory,
  type OffboardingRow,
  type OffboardingSteps,
  type OffboardingStepStatus,
  type OffboardingSystemStep,
} from "./model";
import { authorizeOffboarding, closeAtNoticeEnd } from "./steps";

export {
  NOTICE_DAYS,
  OFFBOARDING_STEPS,
  OFFBOARDING_SYSTEM_STEPS,
  OVERDUE_REMINDER_DAYS,
  type OffboardingOwnerStep,
  type OffboardingReasonCategory,
  type OffboardingStatus,
  type OffboardingStepKey,
  type OffboardingStepStatus,
  type OffboardingSystemStep,
} from "./model";
export type { OffboardingDeps } from "./effects";

/** UI-SPEC STAY-B second line, when the DNS had already moved back. */
export const STAY_HANDED_BACK =
  "Your domain no longer points to us. Connect it again from Settings › Domain.";

const RECORD_ID = /^[a-z0-9]{15}$/;
const CODE_REFUSED = "That code didn't work. Ask for a new one.";

/** Owner-facing step titles (UI-SPEC "/hub/leaving"). */
export const OFFBOARDING_STEP_TITLES: Readonly<
  Record<OffboardingOwnerStep, string>
> = Object.freeze({
  dns_handback: "Move your DNS",
  download: "Download your data",
  addons: "Add-ons",
  services: "Connected services",
  billing: "Billing",
  close: "Your site closes",
});

/** The "Next:" words of the banner (UI-SPEC LeavingBanner). */
const NEXT_WORDS: Readonly<Record<OffboardingOwnerStep, string>> =
  Object.freeze({
    dns_handback: "move your DNS",
    download: "download your data",
    addons: "check your add-ons",
    services: "check your connected services",
    billing: "check your billing",
    close: "your site closes",
  });

const OWNER_ORDER: readonly OffboardingOwnerStep[] = [
  "dns_handback",
  "download",
  "addons",
  "services",
  "billing",
  "close",
];
const SYSTEM_ORDER: readonly OffboardingSystemStep[] = [
  "hosts_removed",
  "site_closed",
  "zone_deleted",
];

function nowOf(v: Date | undefined): Date {
  return v instanceof Date ? v : new Date();
}

// ---------------------------------------------------------------------------------------
// The owner's emailed code (P11 CodeStep pattern; PocketBase OTP as first factor)
// ---------------------------------------------------------------------------------------

async function ownerEmail(userId: string): Promise<string> {
  return withSuperuser(async (pb) => {
    const u = await pb
      .collection("users")
      .getOne(userId, { fields: "id,email" })
      .catch(() => null);
    return typeof u?.email === "string" ? u.email : "";
  });
}

/**
 * Step 1 of the owner's start: email a fresh code ("To confirm, we emailed a code to
 * m•••@gmail.com."). Owner only, never under impersonation.
 */
export async function requestOffboardingCode(
  ctx: OrgContext,
): Promise<{ otpId: string; maskedEmail: string }> {
  assertOrgContext(ctx);
  requirePermission(ctx, "offboarding", "run");
  const email = await ownerEmail(ctx.actor);
  if (!email) throw new Forbidden(CODE_REFUSED);
  try {
    const { otpId } = await guestClient().collection("users").requestOTP(email);
    return { otpId, maskedEmail: maskEmail(email) };
  } catch {
    throw new Forbidden(CODE_REFUSED);
  }
}

async function otpBelongsTo(otpId: string, userId: string): Promise<boolean> {
  return withSuperuser(async (pb) => {
    try {
      const otp = await pb
        .collection("_otps")
        .getOne(otpId, { fields: "id,recordRef" });
      return otp.recordRef === userId;
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        return false;
      }
      throw err;
    }
  });
}

/** Prove the emailed code belongs to the acting owner (sign-in OTP limiter applies). */
async function proveOwnerCode(
  ctx: OrgContext,
  code: { otpId?: unknown; code?: unknown } | undefined,
): Promise<void> {
  const otpId = code?.otpId;
  const value = code?.code;
  if (
    typeof otpId !== "string" ||
    otpId === "" ||
    typeof value !== "string" ||
    value === ""
  ) {
    throw new InvalidInput("Enter the code we emailed you.");
  }
  const attempt = beginSignIn("otp", ctx.ip, otpId);
  if (!RECORD_ID.test(otpId) || !(await otpBelongsTo(otpId, ctx.actor))) {
    throw new Forbidden(CODE_REFUSED);
  }
  const pb = guestClient();
  let proved = false;
  try {
    const res = await pb.collection("users").authWithOTP(otpId, value);
    proved = res.record?.id === ctx.actor;
  } catch (err) {
    // An account with MFA on answers a correct first factor with 401 + mfaId.
    proved =
      err instanceof ClientResponseError &&
      err.status === 401 &&
      typeof (err.response as { mfaId?: unknown } | undefined)?.mfaId ===
        "string";
  } finally {
    pb.authStore.clear();
  }
  if (!proved) throw new Forbidden(CODE_REFUSED);
  attempt.succeeded();
}

// ---------------------------------------------------------------------------------------
// Start / cancel (14-39 choice 2)
// ---------------------------------------------------------------------------------------

export type StartOffboardingInput = {
  reasonCategory?: OffboardingReasonCategory | "";
  note?: string;
  /** Owner path: the emailed code. */
  code?: { otpId: string; code: string };
  /** Staff path: why (3-500 characters). */
  reason?: string;
};

function checkInput(
  ctx: OrgContext | PlatformContext,
  input: StartOffboardingInput,
): { category: OffboardingReasonCategory | ""; note: string; reason: string } {
  const cat = input?.reasonCategory ?? "";
  if (
    cat !== "" &&
    !(OFFBOARDING_REASON_CATEGORIES as readonly string[]).includes(cat)
  ) {
    throw new InvalidInput("Pick a reason from the list.");
  }
  const note = typeof input?.note === "string" ? input.note.trim() : "";
  if (note.length > 1000) {
    throw new InvalidInput("Keep it under 1000 characters.");
  }
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (isPlatformContext(ctx) && (reason.length < 3 || reason.length > 500)) {
    throw new InvalidInput("Give a reason (3 to 500 characters).");
  }
  return { category: cat, note, reason };
}

/** Cancel the org's open move (nothing delegated: its pending zone goes too). Never throws. */
async function settleOpenMove(
  orgId: string,
  deps: OffboardingDeps,
): Promise<void> {
  const sys = sysCtx();
  try {
    const move = await openMoveFor(sys, orgId);
    if (move)
      await cancelMove(sys, move.id, "Moving away", deps.moveDeps ?? {});
  } catch (err) {
    console.error(`[offboarding] open move not cancelled: ${errName(err)}`);
  }
  try {
    await withSuperuser(async (pb) => {
      const pending = await pb.collection("dns_zones").getFullList({
        filter: pb.filter("org_id = {:org} && status = 'pending'", {
          org: orgId,
        }),
        fields: "id,domain,provider_zone_id,nameservers",
      });
      const p = deps.provider ?? deps.moveDeps?.provider ?? getDnsProvider();
      for (const z of pending) {
        const zoneId = String(z.provider_zone_id ?? "");
        if (zoneId !== "") {
          // CR-A01: a pending zone the domain already points at is delegated, not spare.
          // Keep it as `active` so dns_handback opens for it.
          const ns = Array.isArray(z.nameservers)
            ? z.nameservers.filter((x): x is string => typeof x === "string")
            : [];
          const mayServe = await zoneMayServe(
            {
              domain: String(z.domain ?? ""),
              providerZoneId: zoneId,
              nameservers: ns,
            },
            { provider: p, resolver: deps.moveDeps?.resolver },
          );
          if (mayServe) {
            await pb.collection("dns_zones").update(z.id, {
              status: "active",
              delegated_at: nowOf(deps.now).toISOString(),
            });
            continue;
          }
          await p.deleteZone(zoneId);
        }
        await pb.collection("dns_zones").update(z.id, {
          status: "deleted",
          provider_zone_id: "",
          nameservers: [],
        });
      }
    });
  } catch (err) {
    console.error(`[offboarding] pending zone not removed: ${errName(err)}`);
  }
}

function startedKey(orgId: string, at: string): string {
  const h = createHash("sha256").update(`${orgId}:${at}`).digest("hex");
  return `offboarding:started:${h.slice(0, 16)}`;
}

/**
 * Start Leaving CDS (D282): a 30-day notice, DNS first. Owner: `offboarding:run` (not under
 * impersonation) + the emailed code. super_admin: `offboard` + a reason. The demo org, a
 * closed site and a running notice are refused. Emails the owner the checklist and rings the
 * bell; audited `offboarding.started` in the same batch as the row.
 */
export async function startOffboarding(
  ctx: OrgContext | PlatformContext,
  orgId: string | undefined,
  input: StartOffboardingInput = {},
  deps: OffboardingDeps = {},
): Promise<OffboardingView> {
  const org = scopedOrgId(ctx, orgId);
  authorizeOffboarding(ctx, "run");
  const { category, note, reason } = checkInput(ctx, input);
  const facts = await orgFacts(org);
  if (!facts) throw new NotFound();
  if (facts.demo) throw new InvalidInput("The demo site can't move away.");
  if (facts.closedReason !== "") {
    throw new InvalidInput("This site is already closed.");
  }
  const existing = await readOffboardingRow(org);
  if (existing?.status === "notice") {
    throw new InvalidInput("Moving away has already started.");
  }
  if (existing?.status === "closed") {
    throw new InvalidInput("This site is already closed.");
  }
  if (isOrgContext(ctx)) await proveOwnerCode(ctx, input.code);

  const now = nowOf(deps.now);
  const at = now.toISOString();
  await settleOpenMove(org, deps);
  const delegated = await withSuperuser((pb) => delegatedZones(pb, org));
  const handbackNeeded = delegated.length > 0;
  const ends = new Date(now.getTime() + NOTICE_DAYS * DAY_MS);
  const kind = isOrgContext(ctx) ? "owner" : "staff";
  const body = {
    org_id: org,
    status: "notice",
    requested_by: ctx.actor,
    requested_by_kind: kind,
    requested_at: at,
    notice_ends_at: ends.toISOString(),
    steps: initialSteps(handbackNeeded, at),
    reason_category: category,
    note: kind === "staff" ? reason : note,
    cancel_reason: "",
    cancelled_at: "",
    closed_at: "",
  };
  const rowId = existing?.id ?? newRecordId();
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    if (existing) batch.collection(OFFBOARDINGS).update(rowId, body);
    else batch.collection(OFFBOARDINGS).create({ id: rowId, ...body });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "offboarding.started",
        organization: org,
        targetCollection: OFFBOARDINGS,
        targetId: rowId,
        meta: {
          by: kind,
          handback: handbackNeeded,
          ...(category ? { reasonCategory: category } : {}),
          ...(existing ? { reopened: true } : {}),
        },
      }),
    );
    await batch.send();
  });
  await notifyOwners(
    org,
    "started",
    { endsOn: ends, sourceKey: startedKey(org, at) },
    deps,
    now,
  );
  const view = await offboardingView(ctx, org, now);
  if (!view) throw new NotFound();
  return view;
}

export type CancelOffboardingResult = {
  view: OffboardingView;
  /** True when the DNS had already moved back (STAY-B second line). */
  dnsHandedBack: boolean;
  /** STAY-B, plus STAY_HANDED_BACK when the DNS had moved back. */
  message: string;
};

/**
 * "Stay with CDS" (owner) or Cancel offboarding (super_admin) during the notice: the row
 * becomes `cancelled` and everything carries on (D282). Refused once the notice has ended.
 */
export async function cancelOffboarding(
  ctx: OrgContext | PlatformContext,
  orgId: string | undefined,
  reason?: string,
  deps: { now?: Date } = {},
): Promise<CancelOffboardingResult> {
  const org = scopedOrgId(ctx, orgId);
  authorizeOffboarding(ctx, "run");
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length > 500) throw new InvalidInput("Keep it under 500 characters.");
  if (isPlatformContext(ctx) && why.length < 3) {
    throw new InvalidInput("Give a reason (3 to 500 characters).");
  }
  const row = await readOffboardingRow(org);
  if (!row || row.status !== "notice") {
    throw new InvalidInput("There's no notice to cancel.");
  }
  const now = nowOf(deps.now);
  if (
    row.noticeEndsAt &&
    new Date(row.noticeEndsAt).getTime() <= now.getTime()
  ) {
    throw new InvalidInput("Your notice has already ended.");
  }
  const dnsHandedBack = row.steps.dns_handback.status === "done";
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection(OFFBOARDINGS).update(row.id, {
      status: "cancelled",
      cancelled_at: now.toISOString(),
      cancel_reason: why,
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "offboarding.cancelled",
        organization: org,
        targetCollection: OFFBOARDINGS,
        targetId: row.id,
        meta: {
          by: isOrgContext(ctx) ? "owner" : "staff",
          dnsHandedBack,
        },
      }),
    );
    await batch.send();
  });
  const view = await offboardingView(ctx, org, now);
  if (!view) throw new NotFound();
  return {
    view,
    dnsHandedBack,
    message: dnsHandedBack
      ? `${P14_COPY.STAY_B} ${STAY_HANDED_BACK}`
      : P14_COPY.STAY_B,
  };
}

// ---------------------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------------------

export type OffboardingStepView = {
  key: OffboardingOwnerStep | OffboardingSystemStep;
  title: string;
  status: OffboardingStepStatus;
  at: string | null;
};

export type OffboardingView = {
  status: OffboardingRow["status"];
  requestedAt: string | null;
  requestedByKind: "owner" | "staff" | null;
  noticeEndsAt: string | null;
  daysLeft: number;
  /** The first open owner step, in banner words ("move your DNS"); null when none. */
  next: string | null;
  /** UI-SPEC BANNER while the notice runs; null otherwise. */
  banner: string | null;
  steps: OffboardingStepView[];
  /** Staff only: hosts removed, site closed, zone deleted. */
  systemSteps: OffboardingStepView[] | null;
  reasonCategory: OffboardingReasonCategory | null;
  /** Staff only (the owner's note or the staff reason). */
  note: string | null;
  cancelledAt: string | null;
  closedAt: string | null;
  handbackOverdueAt: string | null;
  /** The Owner (or a super_admin) may act: cancel, tick steps. */
  canAct: boolean;
};

const SYSTEM_TITLES: Readonly<Record<OffboardingSystemStep, string>> = {
  hosts_removed: "Hosts removed",
  site_closed: "Site closed",
  zone_deleted: "Zone deleted",
};

/** The org's offboarding (null when it never started). Owner/Admin or staff. */
export async function offboardingView(
  ctx: OrgContext | PlatformContext,
  orgId?: string,
  now: Date = new Date(),
): Promise<OffboardingView | null> {
  const org = scopedOrgId(ctx, orgId);
  authorizeOffboarding(ctx, "read");
  const row = await readOffboardingRow(org);
  if (!row) return null;
  const staff = isPlatformContext(ctx);
  const notice = row.status === "notice";
  const firstOpen = OWNER_ORDER.find((k) => row.steps[k].status === "open");
  const next = notice && firstOpen ? NEXT_WORDS[firstOpen] : null;
  const left = notice ? daysLeft(row, now) : 0;
  const canAct = staff
    ? ctx.staffRole === "super_admin"
    : can(ctx, "offboarding", "run") && !ctx.impersonator;
  return {
    status: row.status,
    requestedAt: row.requestedAt,
    requestedByKind: row.requestedByKind,
    noticeEndsAt: row.noticeEndsAt,
    daysLeft: left,
    next,
    banner: notice && next ? P14_COPY.BANNER({ days: left, next }) : null,
    steps: OWNER_ORDER.map((k) => ({
      key: k,
      title: OFFBOARDING_STEP_TITLES[k],
      status: row.steps[k].status,
      at: row.steps[k].at ?? null,
    })),
    systemSteps: staff
      ? SYSTEM_ORDER.map((k) => ({
          key: k,
          title: SYSTEM_TITLES[k],
          status: row.steps[k].status,
          at: row.steps[k].at ?? null,
        }))
      : null,
    reasonCategory: row.reasonCategory,
    note: staff ? row.note : null,
    cancelledAt: row.cancelledAt,
    closedAt: row.closedAt,
    handbackOverdueAt: row.steps.handback_overdue_at ?? null,
    canAct,
  };
}

// ---------------------------------------------------------------------------------------
// Needs you (14-39 choice 7)
// ---------------------------------------------------------------------------------------

/**
 * "Move your DNS before you leave" while the notice runs and the DNS handback is open.
 * Owner only (the handback is the Owner's); urgent once the notice has ended.
 */
export async function leavingNeedsYou(
  ctx: OrgContext,
  now: Date = new Date(),
): Promise<NeedsYouItem[]> {
  assertOrgContext(ctx);
  if (!can(ctx, "offboarding", "run")) return [];
  const org = scopedOrgId(ctx);
  const row = await readOffboardingRow(org);
  if (!row || row.status !== "notice" || handbackSettled(row.steps)) return [];
  if (row.steps.dns_handback.status !== "open") return [];
  const c = NEEDS_YOU.leavingDns();
  const ended =
    row.noticeEndsAt !== null &&
    new Date(row.noticeEndsAt).getTime() <= now.getTime();
  return [
    {
      key: "leaving:dns",
      kind: "leaving.dns",
      level: ended ? "urgent" : "normal",
      title: c.title,
      sub: c.sub,
      actionLabel: c.action,
      href: LEAVING_HREF,
      section: "settings",
      tab: "billing",
      at: row.requestedAt ?? now.toISOString(),
    },
  ];
}

// ---------------------------------------------------------------------------------------
// Notice end (14-39 choices 5, 5b; the domains:run `offboarding` step, 14-41)
// ---------------------------------------------------------------------------------------

export type AdvanceOffboardingsResult = {
  /** Sites closed this run (or, in a dry run, that would be). */
  closed: number;
  /** Notices still running. */
  waiting: number;
  /** Notices ended with the DNS handback still open (P14-P36). */
  overdue: number;
  /** Sites whose close failed this run (retried next run). */
  errors: number;
};

const OVERDUE_BELL_KEY = "offboarding:handback_overdue";

async function saveSteps(
  row: OffboardingRow,
  steps: OffboardingSteps,
  action: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection(OFFBOARDINGS).update(row.id, { steps });
    batch.collection("audit_log").create(
      auditBody(sysCtx(), {
        action,
        organization: row.orgId,
        targetCollection: OFFBOARDINGS,
        targetId: row.id,
        meta,
      }),
    );
    await batch.send();
  });
}

/**
 * P14-P36: the notice ended with the DNS still at CDS. Nothing closes: the site and the zone
 * keep serving (the tenant's email depends on them). The CDS subscription still ends now (no
 * refund, no further charges) and the rate lock goes; one staff alert, one owner email + bell,
 * then an owner reminder every 7 days.
 */
async function handleOverdue(
  row: OffboardingRow,
  now: Date,
  deps: OffboardingDeps,
): Promise<void> {
  const at = now.toISOString();
  let steps: OffboardingSteps = { ...row.steps };
  if (!steps.billing_ended_at) {
    await endBillingForOffboarding(row.orgId, now, deps);
    steps = { ...steps, billing_ended_at: at };
    await saveSteps(row, steps, "offboarding.notice_ended", {
      handback: "open",
    });
  }
  const end = noticeEnd(row, now);
  if (!steps.handback_overdue_at) {
    steps = {
      ...steps,
      handback_overdue_at: at,
      overdue_mailed_at: at,
      close: { status: "locked" },
    };
    await saveSteps(row, steps, "offboarding.handback_overdue");
    const zones = await withSuperuser((pb) => delegatedZones(pb, row.orgId));
    await alertStaffDomain(
      row.orgId,
      zones[0]?.domain ?? "",
      "handback_overdue",
      deps,
    );
    await notifyOwners(
      row.orgId,
      "overdue",
      { endsOn: end, sourceKey: OVERDUE_BELL_KEY },
      deps,
      now,
    );
    return;
  }
  const last = Date.parse(steps.overdue_mailed_at ?? steps.handback_overdue_at);
  if (now.getTime() - last >= OVERDUE_REMINDER_DAYS * DAY_MS) {
    steps = { ...steps, overdue_mailed_at: at };
    await saveSteps(row, steps, "offboarding.handback_reminder");
    await notifyOwners(
      row.orgId,
      "overdue",
      { endsOn: end, sourceKey: OVERDUE_BELL_KEY },
      deps,
      now,
    );
  }
}

/**
 * Close every notice that has ended with its DNS settled; keep an ended notice open while the
 * DNS handback is not done (P14-P36), and close it on the first run after the handback. The
 * demo org is never offboarded (D293). dryRun counts only and writes nothing.
 */
export async function advanceOffboardings(
  opts: { now?: Date; dryRun?: boolean; deps?: OffboardingDeps } = {},
): Promise<AdvanceOffboardingsResult> {
  const now = nowOf(opts.now);
  const dryRun = opts.dryRun === true;
  const deps: OffboardingDeps = { ...(opts.deps ?? {}), now };
  const out: AdvanceOffboardingsResult = {
    closed: 0,
    waiting: 0,
    overdue: 0,
    errors: 0,
  };
  const rows = await withSuperuser(async (pb) =>
    (
      await pb.collection(OFFBOARDINGS).getFullList({
        filter: "status = 'notice'",
        sort: "notice_ends_at",
      })
    ).map(toOffboardingRow),
  );
  for (const row of rows) {
    if (noticeEnd(row, now).getTime() > now.getTime()) {
      out.waiting += 1;
      continue;
    }
    try {
      const facts = await orgFacts(row.orgId);
      if (!facts || facts.demo) continue;
      if (handbackSettled(row.steps)) {
        if (!dryRun) await closeAtNoticeEnd(row.orgId, deps);
        out.closed += 1;
      } else {
        out.overdue += 1;
        if (!dryRun) await handleOverdue(row, now, deps);
      }
    } catch (err) {
      out.errors += 1;
      console.error(`[offboarding] notice end failed: ${errName(err)}`);
    }
  }
  return out;
}
