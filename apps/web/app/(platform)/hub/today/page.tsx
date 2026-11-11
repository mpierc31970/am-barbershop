// Today (11-17; DASH-02, DASH-19, DASH-20, DASH-30, DASH-31, DASH-33; D29, D172, D310,
// D312; 11-UI-SPEC "Today" lines 402-492, role variants 559-571; D-UI-P11-9, 10, 13, 25, 26;
// T-11-17-01, T-11-17-02). /hub lands here for every stage past fit_review. Mode: Operate.
// Order: status line → stage block full width, then from 1024px a main column (work in
// progress, Needs you, Today cards) + a 360px side rail (This week, phone card (11-22), From
// CDS); below 1024px one column in that order (11-19).
// Every read starts at once (today-data.ts) and each section streams behind its own
// skeleton; a failed section shows ERR-SECTION in place and the others render.
// - Stage block: Being built → BuildTracker; Ready for your review → LaunchReviewCard
//   (Continue review only for the Owner and only once P14 reports it available), the
//   tracker for Editors / Viewers; Live → none. Staff / Renter members get no stage block.
// - You're live: the first visit after launch, once per person, replaces the status line
//   and stage block; Show my Today or any step link sets the seen flag.
// - Needs you: absent for Viewers (D310); items are the layout's per-request getNeedsYou()
//   list, already filtered by access on the server. An empty list whose providers failed
//   shows ERR-SECTION, never a false "You're all caught up."
// 11-48 (DASH-17, D208): first-use tour `today` (status line, Needs you, Your day, Customize).
// 12-29 (COMM-02): the org's pinned CDS note leads the From CDS card. Loaded here
// (pinnedNoteForFromCds returns null without support:read); a failed read logs the error
// class only and the card falls back to the P11 kinds (T-12-29-02).
import { deriveTracker } from "@cds/core/today";
import { ScreenHeader } from "@cds/ui/hub/shell";
import {
  BuildTracker,
  BuildWorkCard,
  LaunchReviewCard,
  NeedsYouList,
  StatusLine,
  ThisWeek,
  TODAY_CARDS_COPY,
  TodaySectionError,
  youreLiveSteps,
  type BuildWorkJob,
} from "@cds/ui/hub/today";
import {
  listMyDevices,
  pinnedNoteForFromCds,
  pushPublicKey,
  readMemberPrefs,
  type NeedsYouResult,
  type OrgContext,
} from "@cds/db";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import type { FromCdsData, TodayCardsData } from "./cards";
import {
  CardsSkeleton,
  NeedsYouSkeleton,
  RailSkeleton,
  StageSkeleton,
} from "./skeletons";
import { PhoneAlertsPanel } from "./PhoneAlertsPanel";
import { FromCdsPanel, TodayCardsPanel } from "./TodayCardsPanel";
import {
  startTodayLoads,
  type Section,
  type ThisWeekData,
  type TodayStageData,
} from "./today-data";
import { YoureLivePanel } from "./YoureLivePanel";
import { TourSlot } from "../tour-slot";

export const metadata: Metadata = { title: "Today" };

export const dynamic = "force-dynamic";

const NEEDS_YOU_TITLE = "Needs you";

function stageBlock(d: TodayStageData): ReactNode {
  const { stage } = d.status;
  if (d.mode === "none") return null;
  const tracker = (
    <BuildTracker
      steps={deriveTracker({
        stage,
        paidAt: d.status.paidAt,
        assembly: d.assembly,
        buildStartedAt: d.status.buildStartedAt,
        launchedAt: d.status.launchedAt,
      })}
      note={d.status.buildNote}
      noteAt={d.status.buildNoteAt}
      timeZone={d.timeZone}
    />
  );
  if (stage === "ready_for_build" || stage === "being_built") return tracker;
  if (stage !== "ready_for_review") return null;
  if (d.mode === "tracker-only") return tracker;
  if (!d.review || !d.review.ok) {
    return <TodaySectionError LinkComponent={GuardedLink} />;
  }
  const r = d.review.data;
  return (
    <LaunchReviewCard
      items={r.items}
      done={r.done}
      total={r.total}
      available={r.available}
      canContinue={d.canContinueReview}
      submitted={d.reviewSubmitted}
      LinkComponent={GuardedLink}
    />
  );
}

async function StageSection({
  load,
  host,
}: {
  load: Promise<Section<TodayStageData>>;
  host: string | null;
}) {
  const res = await load;
  if (!res.ok) {
    return (
      <div className="flex flex-col gap-4">
        <ScreenHeader
          title="Today"
          helpId="today"
          LinkComponent={GuardedLink}
        />
        <TodaySectionError LinkComponent={GuardedLink} />
      </div>
    );
  }
  const d = res.data;
  const statusLine = (
    <StatusLine
      greeting={d.greeting}
      stage={d.status.stage}
      host={host}
      LinkComponent={GuardedLink}
    />
  );
  if (d.youreLive && host) {
    return (
      <YoureLivePanel host={host} steps={youreLiveSteps(d.outreachHref)}>
        {statusLine}
      </YoureLivePanel>
    );
  }
  const block = stageBlock(d);
  return (
    <div className="flex flex-col gap-8" data-today-stage={d.status.stage}>
      {statusLine}
      {block}
    </div>
  );
}

async function NeedsYouSection({
  load,
  now,
}: {
  load: Promise<Section<NeedsYouResult>>;
  now: number;
}) {
  const res = await load;
  if (!res.ok || (res.data.items.length === 0 && res.data.failed.length > 0)) {
    return (
      <TodaySectionError title={NEEDS_YOU_TITLE} LinkComponent={GuardedLink} />
    );
  }
  return (
    <NeedsYouList
      items={res.data.items}
      now={now}
      LinkComponent={GuardedLink}
    />
  );
}

async function BuildWorkSection({ load }: { load: Promise<BuildWorkJob[]> }) {
  const jobs = await load;
  return <BuildWorkCard jobs={jobs} LinkComponent={GuardedLink} />;
}

async function CardsSection({
  load,
  impersonating,
}: {
  load: Promise<Section<TodayCardsData | null>>;
  impersonating: boolean;
}) {
  const res = await load;
  if (!res.ok) {
    return (
      <TodaySectionError
        title={TODAY_CARDS_COPY.yourDay}
        LinkComponent={GuardedLink}
      />
    );
  }
  if (!res.data) return null;
  return <TodayCardsPanel {...res.data} impersonating={impersonating} />;
}

async function WeekSection({ load }: { load: Promise<Section<ThisWeekData>> }) {
  const res = await load;
  if (!res.ok) {
    return (
      <TodaySectionError
        title={TODAY_CARDS_COPY.thisWeek}
        LinkComponent={GuardedLink}
      />
    );
  }
  const w = res.data.week;
  return (
    <ThisWeek
      live={res.data.live && w !== null}
      days={w?.days.now ?? []}
      rows={
        w
          ? [
              {
                id: "visitors",
                name: TODAY_CARDS_COPY.visitors,
                ...w.visitors,
              },
              {
                id: "messages",
                name: TODAY_CARDS_COPY.messages,
                ...w.inquiries,
              },
            ]
          : []
      }
      LinkComponent={GuardedLink}
    />
  );
}

async function FromCdsSection({
  load,
  impersonating,
}: {
  load: Promise<Section<FromCdsData | null>>;
  impersonating: boolean;
}) {
  const res = await load;
  // An optional card: when it can't load (or there is none) the rail simply ends.
  if (!res.ok || !res.data) return null;
  return (
    <FromCdsPanel
      card={res.data.card}
      steps={res.data.steps}
      impersonating={impersonating}
    />
  );
}

/** Seen flag set by the card's Not now (apps/web/app/actions/push.ts). */
const PHONE_ALERTS_FLAG = "phone_alerts";

/**
 * 11-22 (DASH-34): the one-time Phone alerts card. Shown until the person dismisses it or has
 * any device on; never to impersonating staff; not at all until Web Push keys are set. An
 * optional card: a failed read simply leaves it out.
 */
async function PhoneAlertsSection({ ctx }: { ctx: OrgContext }) {
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return null;
  const publicKey = pushPublicKey();
  if (!publicKey) return null;
  try {
    const [prefs, devices] = await Promise.all([
      readMemberPrefs(ctx),
      listMyDevices(ctx),
    ]);
    if (prefs.seenFlags.includes(PHONE_ALERTS_FLAG) || devices.length > 0) {
      return null;
    }
  } catch {
    return null;
  }
  return <PhoneAlertsPanel publicKey={publicKey} />;
}

export default async function TodayPage() {
  const { ctx, org } = await requireHubSession();
  const now = new Date();
  const note = pinnedNoteForFromCds(ctx).catch((err: unknown) => {
    console.error(
      "[today] pinned note failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  });
  const loads = startTodayLoads(ctx, now, { note });
  return (
    <div className="flex max-w-[1272px] flex-col gap-8" data-today="">
      <Suspense fallback={<StageSkeleton />}>
        <StageSection load={loads.stage} host={org.primaryHost} />
      </Suspense>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-8" data-today-main="">
          <Suspense fallback={null}>
            <BuildWorkSection load={loads.buildWork} />
          </Suspense>
          {loads.showNeedsYou ? (
            <div data-tour="today-needs-you">
              <Suspense fallback={<NeedsYouSkeleton />}>
                <NeedsYouSection load={loads.needsYou} now={now.getTime()} />
              </Suspense>
            </div>
          ) : null}
          <Suspense fallback={<CardsSkeleton />}>
            <CardsSection
              load={loads.cards}
              impersonating={loads.impersonating}
            />
          </Suspense>
        </div>
        <div className="flex min-w-0 flex-col gap-8" data-today-rail="">
          {loads.week ? (
            <Suspense fallback={<RailSkeleton />}>
              <WeekSection load={loads.week} />
            </Suspense>
          ) : null}
          <Suspense fallback={null}>
            <PhoneAlertsSection ctx={ctx} />
          </Suspense>
          <Suspense fallback={null}>
            <FromCdsSection
              load={loads.fromCds}
              impersonating={loads.impersonating}
            />
          </Suspense>
        </div>
      </div>
      {/* 11-48 (DASH-17): the first-use tour (never for impersonating staff). */}
      <Suspense fallback={null}>
        <TourSlot ctx={ctx} tourId="today" />
      </Suspense>
    </div>
  );
}
