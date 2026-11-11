// The org's onboarding stage and path, for the hub layout redirect and nav (ONB-01; 06-18),
// plus its slug (the email preview's <slug>@<mail domain> From, 06-22).
// Any member role may read it; the org id comes from the context, never from input.
// being_built: P8 assembly finished and handed the site to the owner (D312, TMPL-04).
// P11 (11-03; D312, DASH-02/30/33): ready_for_review (CDS finished, the owner reviews) and
// live (final; launched_at set). setOrgStage is the ONE stage transition: forward only,
// audited in the same batch as the write (T-11-03-01..03).
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import {
  authorize,
  authorizeStaff,
  Forbidden,
  InvalidInput,
  NotFound,
} from "@cds/core";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { raiseAlert } from "./alerts/raise";
import { auditBody } from "./audit";
import { withSuperuser } from "./client";
import { withOrgLock } from "./content/lock";
import { siteUrls } from "./content/shared";
import {
  assertOrgContext,
  assertPlatformContext,
  isOrgContext,
  isPlatformContext,
  assertSystemContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "./context";
import { launchReviewState } from "./launch-review/progress";

export type OrgStage =
  | "intake"
  | "fit_review"
  | "ready_for_build"
  | "being_built"
  | "ready_for_review"
  | "live"
  | "";

/** Every stored stage, in forward order (Pitfall 1: widen together with OrgStage). */
export const ORG_STAGES = Object.freeze([
  "intake",
  "fit_review",
  "ready_for_build",
  "being_built",
  "ready_for_review",
  "live",
] as const);
const STAGES: readonly string[] = ORG_STAGES;

/** True for a stored stage name (not ""). */
export function isOrgStage(v: unknown): v is Exclude<OrgStage, ""> {
  return typeof v === "string" && STAGES.includes(v);
}

const ORG_ID = /^[a-z0-9]{15}$/;
export const BUILD_NOTE_MAX = 280;

function stageOf(v: unknown): OrgStage {
  return typeof v === "string" && STAGES.includes(v) ? (v as OrgStage) : "";
}

/** Now in PocketBase's stored date format ("YYYY-MM-DD HH:MM:SS.sssZ"), so reads match. */
function pbNow(): string {
  return new Date().toISOString().replace("T", " ");
}

function dateOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export async function getOrgStage(
  ctx: OrgContext,
): Promise<{ stage: OrgStage; path: AddonPath | ""; slug: string }> {
  assertOrgContext(ctx);
  const row = await withSuperuser((pb) =>
    pb
      .collection("organizations")
      .getOne(ctx.orgId, { fields: "stage,path,slug" }),
  );
  const path = typeof row.path === "string" ? row.path : "";
  return {
    stage: stageOf(row.stage),
    path: (ADDON_PATHS as readonly string[]).includes(path)
      ? (path as AddonPath)
      : "",
    slug: typeof row.slug === "string" ? row.slug : "",
  };
}

/**
 * The org's preview address for the owner's "See your site's preview" link (08-09; CONTEXT
 * A2-Q5, A4-Q3): the first primary host as `https://<host>/`, or null. The org id comes
 * from the context only (T-08-09-01). Never throws to the page: a failure is logged
 * without ids and reads as null, so the hub shows the status line without a link.
 */
export async function getSitePreviewUrl(
  ctx: OrgContext,
): Promise<string | null> {
  assertOrgContext(ctx);
  try {
    const urls = await withSuperuser((pb) => siteUrls(pb, ctx.orgId));
    return urls[0] ?? null;
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    console.error(`[org-stage] preview url unavailable (${name})`);
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// P11 (11-03): the one stage transition, status read, build note, launch review stand-in

type AnyContext = OrgContext | PlatformContext | SystemContext;

/**
 * Who may move a stage: the Owner (launch_approval:run), super_admin staff, or a system job.
 * The Owner only approves the launch (ready_for_review -> live, checked under the lock in
 * setOrgStage; review 11 WR-B06).
 */
function authorizeStage(ctx: AnyContext, orgId: string): void {
  if (isOrgContext(ctx)) {
    authorize(ctx, "launch_approval", "run");
    if (orgId !== ctx.orgId) {
      throw new InvalidInput("organization is taken from the context");
    }
    return;
  }
  if (isPlatformContext(ctx)) {
    authorizeStaff(ctx.staffRole, "org_stage");
    return;
  }
  assertSystemContext(ctx);
}

function orgIdOf(v: unknown): string {
  if (typeof v !== "string" || !ORG_ID.test(v)) {
    throw new InvalidInput("organization id is invalid");
  }
  return v;
}

async function loadOrg(orgId: string): Promise<RecordModel> {
  try {
    return await withSuperuser((pb) =>
      pb.collection("organizations").getOne(orgId, {
        fields: "id,stage,launched_at,status",
      }),
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound("organization not found");
    }
    throw err;
  }
}

/**
 * Move an org's stage forward (D312). Order: intake < fit_review < ready_for_build <
 * being_built < ready_for_review < live. `live` is final and sets launched_at once (an
 * existing value is kept). The same stage is a no-op ({changed: false}, no audit row). A
 * backward move or an unknown stage throws InvalidInput. The write and its
 * `org.stage_changed` audit row ({from, to}) commit in one batch.
 *
 * Review 11 WR-A01: this is never a way around the fit gate. A site in `fit_review` is
 * cleared only by the fit module (`fit:review`: case print, blocked override, owner email),
 * and a `held` or `disabled` (closed) site never moves. The read and the write run under
 * the org lock, as fit.ts and intake/send.ts do, so a concurrent Send to CDS cannot move
 * the stage back over this write.
 */
export async function setOrgStage(
  ctx: AnyContext,
  orgId: string,
  to: OrgStage,
  opts: {
    /**
     * 14-23: the caller already holds this org's withOrgLock (the domain move runner's
     * cutover step). withOrgLock is not reentrant, so taking it again would deadlock.
     */
    callerHoldsOrgLock?: boolean;
  } = {},
): Promise<{ changed: boolean; launchedAt: string | null }> {
  if (!isOrgContext(ctx) && !isPlatformContext(ctx)) assertSystemContext(ctx);
  const id = orgIdOf(orgId);
  authorizeStage(ctx, id);
  if (!STAGES.includes(to)) throw new InvalidInput("unknown stage");

  const locked = <T>(fn: () => Promise<T>): Promise<T> =>
    opts.callerHoldsOrgLock === true ? fn() : withOrgLock(id, fn);
  const moved = await locked(async () => {
    const row = await loadOrg(id);
    const from = stageOf(row.stage);
    const launched = dateOrNull(row.launched_at);
    if (from === to) return { changed: false, launchedAt: launched };
    if (from !== "" && STAGES.indexOf(to) < STAGES.indexOf(from)) {
      throw new InvalidInput("a stage only moves forward");
    }
    if (from === "fit_review") {
      throw new InvalidInput("use fit:review to clear a site in fit review");
    }
    // WR-B06: an Owner never skips fit review, payment or the build.
    if (isOrgContext(ctx) && !(from === "ready_for_review" && to === "live")) {
      throw new Forbidden("the owner only approves the launch");
    }
    const status = typeof row.status === "string" ? row.status : "";
    if (status === "held" || status === "disabled") {
      throw new InvalidInput(
        `the site is ${status === "held" ? "held" : "closed or disabled"}; its stage cannot move`,
      );
    }

    const launchedAt = to === "live" ? (launched ?? pbNow()) : launched;
    const body: Record<string, unknown> = { stage: to };
    if (to === "live" && !launched) body.launched_at = launchedAt;

    await withSuperuser(async (pb) => {
      const batch = pb.createBatch();
      batch.collection("organizations").update(id, body);
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "org.stage_changed",
          organization: id,
          targetCollection: "organizations",
          targetId: id,
          meta: { from, to },
        }),
      );
      await batch.send();
    });
    return { changed: true, launchedAt };
  });
  if (!moved.changed) return moved;
  const { launchedAt } = moved;
  liveCache.delete(id);
  // 11-21 (DASH-35): tell the team after the stage committed. Best effort: raiseAlert never
  // throws, so a failed alert never undoes or fails the stage change.
  if (to === "ready_for_review" || to === "live") {
    await raiseAlert(
      isOrgContext(ctx)
        ? ctx
        : { orgId: id, as: mintSystemContext({ job: "org-stage" }) },
      {
        type: "site.stage",
        sourceKey: `stage:${to}`,
        title:
          to === "live"
            ? "Your site is live."
            : "Your site is ready for your review.",
        safeTitle:
          to === "live" ? "Your site is live" : "Your site is ready for review",
        href: "/hub/today",
        actionLabel: to === "live" ? "See what's next" : "Start your review",
      },
    );
  }
  return { changed: true, launchedAt };
}

export type OrgAnalytics = {
  ga4_measurement_id?: string;
  ga4_property_id?: string;
  gsc_site_url?: string;
  owner?: "cds" | "tenant";
};

function analyticsOf(v: unknown): OrgAnalytics {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const src = v as Record<string, unknown>;
  const out: OrgAnalytics = {};
  for (const k of [
    "ga4_measurement_id",
    "ga4_property_id",
    "gsc_site_url",
  ] as const) {
    if (typeof src[k] === "string" && src[k] !== "") out[k] = src[k];
  }
  if (src.owner === "cds" || src.owner === "tenant") out.owner = src.owner;
  return out;
}

export type OrgStatus = {
  stage: OrgStage;
  launchedAt: string | null;
  paidAt: string | null;
  buildStartedAt: string | null;
  buildNote: string;
  buildNoteAt: string | null;
  analytics: OrgAnalytics;
};

/**
 * The org's stage, dates, CDS build note and analytics ids, for Today and the tracker. Any
 * member may read it. Never throws for a valid context: a failed read is logged without ids
 * and reads as the empty status.
 */
export async function readOrgStatus(ctx: OrgContext): Promise<OrgStatus> {
  assertOrgContext(ctx);
  const empty: OrgStatus = {
    stage: "",
    launchedAt: null,
    paidAt: null,
    buildStartedAt: null,
    buildNote: "",
    buildNoteAt: null,
    analytics: {},
  };
  try {
    return await withSuperuser(async (pb) => {
      const row = await pb.collection("organizations").getOne(ctx.orgId, {
        fields:
          "stage,launched_at,build_started_at,build_note,build_note_at,analytics",
      });
      let paidAt: string | null = null;
      try {
        const acct = await pb
          .collection("billing_accounts")
          .getFirstListItem(
            pb.filter("organization = {:org}", { org: ctx.orgId }),
            { fields: "paid_at" },
          );
        paidAt = dateOrNull(acct.paid_at);
      } catch (err) {
        if (!(err instanceof ClientResponseError && err.status === 404)) {
          throw err;
        }
      }
      return {
        stage: stageOf(row.stage),
        launchedAt: dateOrNull(row.launched_at),
        paidAt,
        buildStartedAt: dateOrNull(row.build_started_at),
        buildNote: typeof row.build_note === "string" ? row.build_note : "",
        buildNoteAt: dateOrNull(row.build_note_at),
        analytics: analyticsOf(row.analytics),
      };
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    console.error(`[org-stage] status unavailable (${name})`);
    return empty;
  }
}

/**
 * Set (or clear with "") the CDS build note shown on Today while the site is being built.
 * Staff only (`build_note`); at most 280 characters; audited `org.build_note_set` in the
 * same batch (the note text is not copied into the audit meta, only its length).
 */
export async function setBuildNote(
  ctx: PlatformContext,
  orgId: string,
  note: string,
): Promise<void> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "build_note");
  const id = orgIdOf(orgId);
  if (typeof note !== "string") throw new InvalidInput("note must be text");
  const text = note.trim();
  if (text.length > BUILD_NOTE_MAX) {
    throw new InvalidInput(
      `the build note is at most ${BUILD_NOTE_MAX} characters`,
    );
  }
  await loadOrg(id);
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection("organizations").update(id, {
      build_note: text,
      build_note_at: text ? pbNow() : "",
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "org.build_note_set",
        organization: id,
        targetCollection: "organizations",
        targetId: id,
        meta: { length: text.length },
      }),
    );
    await batch.send();
  });
}

export type StaffOrgStage = {
  orgName: string;
  stage: OrgStage;
  launchedAt: string | null;
  buildNote: string;
  /** organizations.status (active, held, disabled); a held or closed site never moves. */
  status: string;
};

/**
 * 11-42: an org's name, stage, launch date and build note for the org:stage staff CLI.
 * Staff who may set the build note (`build_note`: super_admin, support_agent) may read it.
 * NotFound for an unknown org.
 */
export async function staffOrgStage(
  ctx: PlatformContext,
  orgId: string,
): Promise<StaffOrgStage> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "build_note");
  const id = orgIdOf(orgId);
  try {
    const row = await withSuperuser((pb) =>
      pb.collection("organizations").getOne(id, {
        fields: "id,name,stage,launched_at,build_note,status",
      }),
    );
    return {
      orgName: typeof row.name === "string" ? row.name : "",
      stage: stageOf(row.stage),
      launchedAt: dateOrNull(row.launched_at),
      buildNote: typeof row.build_note === "string" ? row.build_note : "",
      status: typeof row.status === "string" ? row.status : "",
    };
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound("organization not found");
    }
    throw err;
  }
}

/** The six D172 launch review items, in order (labels: 11-UI-SPEC LaunchReviewCard). */
export const LAUNCH_REVIEW_ITEMS: readonly { id: string; label: string }[] = [
  { id: "pages_reviewed", label: "Every page looked over" },
  { id: "changes_sent", label: "Changes you asked for" },
  { id: "key_facts", label: "Your key details confirmed" },
  { id: "phone_check", label: "Checked on your phone" },
  { id: "test_form", label: "Test form received" },
  { id: "no_open_requests", label: "No open change requests" },
];

export type LaunchReviewProgress = {
  items: { id: string; label: string; done: boolean }[];
  done: number;
  total: number;
  available: boolean;
};

/**
 * P14 (14-33): the launch review marks (launch_review_marks) computed into the six D172
 * items; available while the stage is ready_for_review (Today shows Continue review).
 * "Edited after approval resets it" is computed, never stored. Same signature as the P11
 * stand-in.
 */
async function launchReviewStore(
  orgId: string,
): Promise<{ done: ReadonlySet<string>; available: boolean }> {
  return launchReviewState(orgId);
}

export async function launchReviewProgress(
  ctx: OrgContext,
): Promise<LaunchReviewProgress> {
  assertOrgContext(ctx);
  const store = await launchReviewStore(ctx.orgId);
  const items = LAUNCH_REVIEW_ITEMS.map((i) => ({
    id: i.id,
    label: i.label,
    done: store.done.has(i.id),
  }));
  return {
    items,
    done: items.filter((i) => i.done).length,
    total: items.length,
    available: store.available,
  };
}

// orgIsLive: a superuser read for public render paths (11-10 404 handling, 11-31 beacon),
// with a short in-process cache so one request asking repeatedly costs one read. setOrgStage
// clears the entry. An unknown or invalid id is not live; a failed read is not live.
const LIVE_TTL_MS = 5_000;
const liveCache = new Map<string, { at: number; live: Promise<boolean> }>();

export async function orgIsLive(orgId: string): Promise<boolean> {
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) return false;
  const now = Date.now();
  const hit = liveCache.get(orgId);
  if (hit && now - hit.at < LIVE_TTL_MS) return hit.live;
  const live = withSuperuser((pb) =>
    pb.collection("organizations").getOne(orgId, { fields: "stage" }),
  ).then(
    (row) => row.stage === "live",
    () => false,
  );
  liveCache.set(orgId, { at: now, live });
  if (liveCache.size > 500) {
    for (const [k, v] of liveCache) {
      if (now - v.at >= LIVE_TTL_MS) liveCache.delete(k);
    }
  }
  return live;
}

/** Drop one org's orgIsLive entry (13-17: suspend and lift). Internal to @cds/db. */
export function forgetOrgLive(orgId: string): void {
  liveCache.delete(orgId);
}

/** Test seam: clear the orgIsLive cache. */
export function __clearOrgLiveCacheForTests(): void {
  liveCache.clear();
}
