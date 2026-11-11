// Today data (11-17; DASH-02, DASH-19, DASH-20, DASH-30, DASH-31, DASH-33; 11-UI-SPEC
// "Today"; T-11-17-01). Server-only. Every read takes the session OrgContext (the org never
// comes from the URL). `startTodayLoads` starts every read at once and hands the page one
// promise per section; each promise resolves (never rejects), so one slow or failing source
// only changes its own section (Suspense + ERR-SECTION), never the whole screen.
// - Stage section: readOrgStatus (never throws), member prefs (seen flags), business time
//   zone (fallback America/Chicago), the P8 assembly ledger while the site is being built
//   (business:read; a refusal or failure reads as "none"), launchReviewProgress while ready
//   for review, and the active add-ons for the You're live Outreach step.
// - Needs you: the same per-request getNeedsYou() list the layout used (pre-filtered by the
//   person's access on the server, so billing rows never reach a non-Owner).
// Role variants (UI-SPEC "Role variants") are decided here as plain flags.
// 11-19: the rail and the rest of the main column: Today cards, This week, From CDS and the
// post-launch work-in-progress card (cards.ts). The org status is read once and shared.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { ADDON_SERVER, activeTodayProviders } from "@cds/addon-registry/server";
import type { OrgRole } from "@cds/core";
import {
  businessTimeZone,
  DEFAULT_TIME_ZONE,
  greetingFor,
  type AssemblyState,
} from "@cds/core/today";
import {
  activeAddons,
  launchReviewProgress,
  launchReviewView,
  orgPlanPath,
  pausedAddons,
  readLedger,
  readMemberPrefs,
  readOrgStatus,
  statsTimeZone,
  weekNumbers,
  type LaunchReviewProgress,
  type MemberPrefs,
  type NeedsYouResult,
  type OrgContext,
  type OrgStatus,
  type WeekNumbers,
} from "@cds/db";
import type { BuildWorkJob } from "@cds/ui/hub/today";
import { getNeedsYou } from "../../../../lib/needs-you";
import { addonHref } from "../nav";
import {
  asAddonPath,
  loadBuildWork,
  loadFromCds,
  loadTodayCards,
  type FromCdsData,
  type Section,
  type TodayCardsData,
  type TodayRailDeps,
} from "./cards";

/** The seen flag of the one-time You're live screen (member_prefs.seenFlags). */
export const YOURE_LIVE_FLAG = "youre_live";

/** Add-on slugs that count as "an Outreach add-on" for You're live step 3. */
const OUTREACH_SLUGS: readonly string[] = ["outreach"];

const BUILD_STAGES: readonly string[] = ["ready_for_build", "being_built"];

export type { Section } from "./cards";

/** This week (DASH-23, DASH-32): `week` is null before launch (WEEK-PRELAUNCH). */
export type ThisWeekData = { live: boolean; week: WeekNumbers | null };

/** What the stage block shows for this person (UI-SPEC role variants). */
export type StageBlockMode = "full" | "read-only" | "tracker-only" | "none";

export type TodayStageData = {
  status: OrgStatus;
  timeZone: string;
  greeting: string;
  mode: StageBlockMode;
  /** The Owner (not impersonated) may press Continue review. */
  canContinueReview: boolean;
  assembly: AssemblyState;
  /** Only while ready_for_review; `{ ok: false }` when that read failed. */
  review: Section<LaunchReviewProgress> | null;
  /** 14-34: the owner sent the review (SUBMITTED-H on the card); false when unknown. */
  reviewSubmitted: boolean;
  /** Show the one-time You're live screen. */
  youreLive: boolean;
  /** The active Outreach add-on's tab, for You're live step 3. */
  outreachHref: string | null;
};

export type TodayLoads = {
  stage: Promise<Section<TodayStageData>>;
  needsYou: Promise<Section<NeedsYouResult>>;
  /** Viewers see no Needs-you section at all (D310). */
  showNeedsYou: boolean;
  /** 11-19: Today cards (null data for Viewers: the section is absent). */
  cards: Promise<Section<TodayCardsData | null>>;
  /** 11-19: This week; absent (null) for Staff / Renter members. */
  week: Promise<Section<ThisWeekData>> | null;
  /** 11-19: at most one From CDS card. */
  fromCds: Promise<Section<FromCdsData | null>>;
  /** 11-19: open CDS work after launch (Owner only); [] otherwise. */
  buildWork: Promise<BuildWorkJob[]>;
  /** Impersonating CDS staff: no Dismiss, read-only Customize. */
  impersonating: boolean;
};

/**
 * 14-34: whether the launch review was sent and nothing changed since (the card then reads
 * SUBMITTED-H with no button). Any failure reads as not sent (the card keeps Continue review).
 */
async function loadReviewSubmitted(ctx: OrgContext): Promise<boolean> {
  try {
    const v = await launchReviewView(ctx);
    return v.submittedAt !== null && v.resubmitNeeded.length === 0;
  } catch (err) {
    logFail("launch review submitted", err);
    return false;
  }
}

function logFail(what: string, err: unknown): void {
  console.error(
    `[today] ${what} failed`,
    err instanceof Error ? err.name : typeof err,
  );
}

/** Staff / Renter: no stage block; Viewer and Editor: tracker only; Admin and impersonating
 * CDS staff: read-only (no Continue review); Owner: full. */
export function stageBlockMode(
  role: OrgRole | string,
  impersonating: boolean,
): StageBlockMode {
  if (role === "staff" || role === "renter") return "none";
  if (role === "editor" || role === "viewer") return "tracker-only";
  if (impersonating || role === "admin") return "read-only";
  return role === "owner" ? "full" : "tracker-only";
}

function assemblyOf(status: string): AssemblyState {
  return status === "running" || status === "done" || status === "failed"
    ? status
    : "none";
}

async function loadAssembly(ctx: OrgContext): Promise<AssemblyState> {
  try {
    return assemblyOf((await readLedger(ctx)).ledger.status);
  } catch (err) {
    // A Viewer can't read the intake row, and a site without one has no run: the tracker
    // then decides from the stage alone.
    if (!(err instanceof Error && /Forbidden|NotFound/.test(err.name))) {
      logFail("assembly", err);
    }
    return "none";
  }
}

async function loadTimeZone(ctx: OrgContext): Promise<string> {
  try {
    return businessTimeZone(await statsTimeZone(ctx));
  } catch (err) {
    if (!(err instanceof Error && err.name === "Forbidden")) {
      logFail("time zone", err);
    }
    return DEFAULT_TIME_ZONE;
  }
}

/** Null when prefs can't be read (then the one-time screen is not shown: never nag). */
async function loadPrefs(ctx: OrgContext): Promise<MemberPrefs | null> {
  try {
    return await readMemberPrefs(ctx);
  } catch (err) {
    logFail("prefs", err);
    return null;
  }
}

async function loadOutreachHref(ctx: OrgContext): Promise<string | null> {
  try {
    const active = await activeAddons(ctx);
    const slug = OUTREACH_SLUGS.find((s) => active.includes(s));
    const manifest = slug ? ADDON_REGISTRY.get(slug) : undefined;
    return manifest ? addonHref(manifest) : null;
  } catch (err) {
    logFail("active add-ons", err);
    return null;
  }
}

async function loadStage(
  ctx: OrgContext,
  now: Date,
  tzP: Promise<string>,
  prefsP: Promise<MemberPrefs | null>,
  statusP: Promise<OrgStatus>,
): Promise<Section<TodayStageData>> {
  try {
    const status = await statusP;
    const stage = status.stage;
    const impersonating = Boolean(ctx.impersonator);
    const mode = stageBlockMode(ctx.role, impersonating);
    const live = stage === "live";
    const reviewOpen =
      stage === "ready_for_review" && (mode === "full" || mode === "read-only");
    const [timeZone, prefs, assembly, review, reviewSubmitted] =
      await Promise.all([
        tzP,
        prefsP,
        mode !== "none" && BUILD_STAGES.includes(stage)
          ? loadAssembly(ctx)
          : Promise.resolve<AssemblyState>("none"),
        stage === "ready_for_review" &&
        (mode === "full" || mode === "read-only")
          ? launchReviewProgress(ctx).then(
              (data): Section<LaunchReviewProgress> => ({ ok: true, data }),
              (err: unknown): Section<LaunchReviewProgress> => {
                logFail("launch review", err);
                return { ok: false };
              },
            )
          : Promise.resolve(null),
        reviewOpen ? loadReviewSubmitted(ctx) : Promise.resolve(false),
      ]);
    // You're live: once per person, after launch, never for impersonating staff (they must
    // not consume the owner's one-time screen) or for Staff / Renter members.
    const youreLive =
      live &&
      !impersonating &&
      mode !== "none" &&
      prefs !== null &&
      !prefs.seenFlags.includes(YOURE_LIVE_FLAG);
    return {
      ok: true,
      data: {
        status,
        timeZone,
        greeting: greetingFor(now, timeZone),
        mode,
        canContinueReview: mode === "full" && ctx.role === "owner",
        assembly,
        review,
        reviewSubmitted,
        youreLive,
        outreachHref: youreLive ? await loadOutreachHref(ctx) : null,
      },
    };
  } catch (err) {
    logFail("stage", err);
    return { ok: false };
  }
}

async function loadNeedsYou(): Promise<Section<NeedsYouResult>> {
  try {
    return { ok: true, data: await getNeedsYou() };
  } catch (err) {
    logFail("needs-you", err);
    return { ok: false };
  }
}

/** The org's active, unpaused add-on Today providers (registry only, invariant 4/9). */
async function loadProviders(ctx: OrgContext) {
  try {
    const [active, paused] = await Promise.all([
      activeAddons(ctx),
      pausedAddons(ctx),
    ]);
    return activeTodayProviders(ADDON_REGISTRY, ADDON_SERVER, active, paused);
  } catch (err) {
    logFail("add-on cards", err);
    return null;
  }
}

/** One lazy, shared read (the Inquiries card footer and This week use the same numbers). */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}

async function loadWeek(
  statusP: Promise<OrgStatus>,
  week: () => Promise<WeekNumbers>,
): Promise<Section<ThisWeekData>> {
  try {
    const status = await statusP;
    if (status.stage !== "live") {
      return { ok: true, data: { live: false, week: null } };
    }
    return { ok: true, data: { live: true, week: await week() } };
  } catch (err) {
    logFail("this week", err);
    return { ok: false };
  }
}

async function loadLiveBuildWork(
  ctx: OrgContext,
  statusP: Promise<OrgStatus>,
): Promise<BuildWorkJob[]> {
  try {
    const status = await statusP;
    return status.stage === "live" ? await loadBuildWork(ctx) : [];
  } catch {
    return [];
  }
}

/** Start every Today read in parallel; each promise resolves to a Section. */
export function startTodayLoads(
  ctx: OrgContext,
  now: Date,
  opts: { note?: TodayRailDeps["note"] } = {},
): TodayLoads {
  const showNeedsYou = ctx.role !== "viewer";
  const tz = loadTimeZone(ctx);
  const prefs = loadPrefs(ctx);
  const status = readOrgStatus(ctx);
  const rail: TodayRailDeps = {
    now,
    providers: once(() => loadProviders(ctx)),
    path: once(async () => asAddonPath(await orgPlanPath(ctx))),
    prefs,
    timeZone: tz,
    week: once(() => weekNumbers(ctx, now)),
    note: opts.note,
  };
  const staffLike = ctx.role === "staff" || ctx.role === "renter";
  return {
    cards: loadTodayCards(ctx, rail),
    week: staffLike ? null : loadWeek(status, rail.week),
    fromCds: loadFromCds(ctx, rail),
    buildWork: loadLiveBuildWork(ctx, status),
    impersonating: Boolean(ctx.impersonator),
    stage: loadStage(ctx, now, tz, prefs, status),
    needsYou: showNeedsYou
      ? loadNeedsYou()
      : Promise.resolve({
          ok: true,
          data: { items: [], failed: [] },
        } as const),
    showNeedsYou,
  };
}
