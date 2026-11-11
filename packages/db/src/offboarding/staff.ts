// packages/db/src/offboarding/staff.ts (P14, LIFE-01, DOM-05).
// Owner: 14-40 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The staff side of Leaving CDS (P14-P13, P14-P17; 14-40 choice 6): the console's Site ›
// Offboarding (14-43) and `npm run org:offboard` call these. Every function starts with
// assertPlatformContext + authorizeStaff (`offboard` = super_admin for start/cancel,
// `domains` = both staff roles for the view and the handback re-run), checks the site exists,
// then calls the SAME functions the owner path uses (14-39 offboardings.ts, 14-40
// handback.ts), which audit with `organization` in their own batch. Staff reasons are 3-500
// characters. Step-up is the console's job (14-43); the CLI signs in with the emailed code.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { appendAudit } from "../audit";
import { withSuperuser } from "../client";
import { assertPlatformContext, type PlatformContext } from "../context";
import { orgFacts, type OffboardingDeps } from "./effects";
import {
  checkHandbackDestination,
  handbackView,
  type HandbackDeps,
  type HandbackView,
  type HandbackZoneView,
} from "./handback";
import {
  cancelOffboarding,
  offboardingView,
  startOffboarding,
  type CancelOffboardingResult,
  type OffboardingView,
} from "./offboardings";
import { DAY_MS, NOTICE_DAYS } from "./model";

const ORG_RE = /^[a-z0-9]{15}$/;
export const STAFF_OFFBOARD_REASON_MIN = 3;
export const STAFF_OFFBOARD_REASON_MAX = 500;

export type StaffOffboardingView = {
  orgId: string;
  business: string;
  stage: string;
  demo: boolean;
  closed: boolean;
  /** Null when the site never started leaving. */
  offboarding: OffboardingView | null;
  handback: HandbackView;
  /** A CDS zone is delegated (active or moved): the DNS handback comes first. */
  handbackNeeded: boolean;
  /** Where a notice started now would end (the Start offboarding case). */
  noticeWouldEnd: string;
};

function staff(
  ctx: PlatformContext,
  feature: "offboard" | "domains",
  orgId: string,
): void {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, feature);
  if (typeof orgId !== "string" || !ORG_RE.test(orgId)) {
    throw new NotFound("site not found");
  }
}

async function factsOrNotFound(orgId: string) {
  const facts = await orgFacts(orgId);
  if (!facts) throw new NotFound("site not found");
  return facts;
}

function reasonOf(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (
    r.length < STAFF_OFFBOARD_REASON_MIN ||
    r.length > STAFF_OFFBOARD_REASON_MAX
  ) {
    throw new InvalidInput("Give a reason (3 to 500 characters).");
  }
  return r;
}

/** Site › Offboarding: the notice, its steps (system steps too) and the DNS handback. */
export async function staffOffboardingView(
  ctx: PlatformContext,
  orgId: string,
  deps: HandbackDeps = {},
): Promise<StaffOffboardingView> {
  staff(ctx, "domains", orgId);
  const facts = await factsOrNotFound(orgId);
  const now = deps.now ?? new Date();
  const offboarding = await offboardingView(ctx, orgId, now);
  const handback = await handbackView(ctx, orgId, deps);
  const delegated = await withSuperuser((pb) =>
    pb.collection("dns_zones").getList(1, 1, {
      filter: pb.filter(
        "org_id = {:org} && (status = 'active' || status = 'moved')",
        { org: orgId },
      ),
      skipTotal: true,
      fields: "id",
    }),
  );
  return {
    orgId,
    business: facts.name,
    stage: facts.stage,
    demo: facts.demo,
    closed: facts.closedReason !== "",
    offboarding,
    handback,
    handbackNeeded: delegated.items.length > 0,
    noticeWouldEnd: new Date(
      now.getTime() + NOTICE_DAYS * DAY_MS,
    ).toISOString(),
  };
}

/** Start offboarding for a site (super_admin; reason 3-500). The owner is emailed. */
export async function staffStartOffboarding(
  ctx: PlatformContext,
  orgId: string,
  input: { reason: string },
  deps: OffboardingDeps = {},
): Promise<OffboardingView> {
  staff(ctx, "offboard", orgId);
  const reason = reasonOf(input?.reason);
  await factsOrNotFound(orgId);
  return startOffboarding(ctx, orgId, { reason }, deps);
}

/** Cancel a running notice (super_admin; reason 3-500). The plan and price carry on. */
export async function staffCancelOffboarding(
  ctx: PlatformContext,
  orgId: string,
  reason: string,
  deps: { now?: Date } = {},
): Promise<CancelOffboardingResult> {
  staff(ctx, "offboard", orgId);
  const why = reasonOf(reason);
  await factsOrNotFound(orgId);
  return cancelOffboarding(ctx, orgId, why, deps);
}

/**
 * "Re-run handback check" (both staff roles): every zone in a handback (or just `domain`)
 * goes through the destination check, or the public check once switched. Audited
 * `offboarding.handback_rerun` with the organization.
 */
export async function staffRerunHandback(
  ctx: PlatformContext,
  orgId: string,
  domain?: string,
  deps: HandbackDeps = {},
): Promise<HandbackZoneView[]> {
  staff(ctx, "domains", orgId);
  await factsOrNotFound(orgId);
  const view = await handbackView(ctx, orgId, deps);
  const zones = view.zones.filter(
    (z) =>
      (domain === undefined || z.domain === domain) &&
      z.destination !== null &&
      (z.zoneStatus === "active" || z.zoneStatus === "moved"),
  );
  if (zones.length === 0) {
    throw new InvalidInput(
      domain === undefined
        ? "There's no DNS handback to check yet: the owner hasn't chosen where the DNS goes."
        : "That domain has no DNS handback to check.",
    );
  }
  const out: HandbackZoneView[] = [];
  for (const z of zones) {
    out.push(await checkHandbackDestination(ctx, orgId, z.domain, deps));
  }
  await appendAudit(ctx, {
    action: "offboarding.handback_rerun",
    organization: orgId,
    targetCollection: "dns_zones",
    meta: { zones: out.length, statuses: out.map((z) => z.status) },
  });
  return out;
}
