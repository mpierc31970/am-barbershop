// /hub/leaving: the owner's Leaving CDS screen (14-42 choice 4; LIFE-01, D282, D284, D263,
// D161, D-UI-P14-21, D-UI-P14-23; 14-UI-SPEC "Leaving CDS (owner)"; T-14-42-01..03).
//   - Access: Owners act; Admins read the running checklist (no buttons); everyone else gets
//     notFound(). CDS staff viewing as the owner see the start page with the button turned
//     off (IMPERSONATING-LEAVE) and the checklist read-only (offboardingView.canAct).
//   - No running notice (never started, or cancelled: a cancelled row can be re-opened) →
//     LeaveStartPanel, its lines from offboardingChecklist's preview (dated from today).
//     Admins have nothing to read there → notFound().
//   - Notice → LeavingChecklist with one HandbackFlow per domain still at CDS (handbackView).
//   - Closed → Settings › Billing.
//   - ScreenHeader "?" only once the help map knows `leaving-cds` (14-46 writes it; P13-P12).
// Load failures are logged by class name only and shown as one InlineAlert.
import { can } from "@cds/core";
import {
  STAY_HANDED_BACK,
  handbackView,
  offboardingChecklist,
  offboardingView,
  type OffboardingChecklist,
  type OffboardingView,
} from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { LEAVING_UI_COPY, type HandbackZoneUi } from "@cds/ui/hub/leaving";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { findHelpEntry } from "../../../../lib/help-index";
import { requireHubSession } from "../../../../lib/session";
import { ChecklistIsland, StartIsland } from "./LeavingIslands";
import {
  longDay,
  offboardingManifests,
  shortDay,
  toHandbackUi,
} from "./leaving-view";

export const metadata: Metadata = { title: "Leaving CDS" };

export const dynamic = "force-dynamic";

const BILLING = "/hub/settings?tab=billing";
const HELP_ID = "leaving-cds";
const COLUMN = "mx-auto flex w-full max-w-[720px] flex-col gap-8 font-hub";
const LOAD_FAILED =
  "We couldn't load this. Check your connection and try again.";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export default async function LeavingPage() {
  const { ctx } = await requireHubSession();
  const owner = ctx.role === "owner";
  if (!(owner || ctx.role === "admin") || !can(ctx, "offboarding", "read")) {
    notFound();
  }

  let view: OffboardingView | null = null;
  let checklist: OffboardingChecklist | null = null;
  try {
    view = await offboardingView(ctx);
    if (view?.status !== "closed" && (view?.status === "notice" || owner)) {
      checklist = await offboardingChecklist(ctx, undefined, {
        manifests: offboardingManifests(),
      });
    }
  } catch (err) {
    console.error(`[hub] leaving load failed ${errName(err)}`);
    return (
      <div className={COLUMN}>
        <h1 className="text-[28px] leading-[1.2] font-semibold">
          {LEAVING_UI_COPY.title}
        </h1>
        <InlineAlert tone="error">{LOAD_FAILED}</InlineAlert>
      </div>
    );
  }
  if (view?.status === "closed") redirect(BILLING);
  // Admins read a running notice only; before one there is nothing for them here.
  if (!checklist) notFound();

  const header = findHelpEntry(ctx, [], HELP_ID) ? (
    <ScreenHeader title={LEAVING_UI_COPY.title} helpId={HELP_ID} />
  ) : undefined;
  const endsOn = longDay(checklist.noticeEndsAt);
  const impersonating = Boolean(ctx.impersonator);

  if (view?.status !== "notice") {
    return (
      <StartIsland
        endsOn={endsOn}
        endsOnShort={shortDay(checklist.noticeEndsAt)}
        billingLines={checklist.billing.lines}
        impersonating={impersonating}
        header={header}
      />
    );
  }

  let zones: HandbackZoneUi[] = [];
  let zonesFailed = false;
  try {
    zones = (await handbackView(ctx)).zones.map(toHandbackUi);
  } catch (err) {
    zonesFailed = true;
    console.error(`[hub] leaving handback load failed ${errName(err)}`);
  }
  const dnsStep = checklist.steps.find((s) => s.key === "dns_handback");
  const dnsHandedBack = dnsStep?.status === "done";

  return (
    <div className="flex flex-col gap-6">
      {zonesFailed ? (
        <div className="mx-auto w-full max-w-[720px]">
          <InlineAlert tone="error">{LOAD_FAILED}</InlineAlert>
        </div>
      ) : null}
      <ChecklistIsland
        header={header}
        endsOn={endsOn}
        daysLeft={view.daysLeft}
        steps={checklist.steps}
        zones={zones}
        downloadLine={checklist.download.line}
        addons={checklist.addons}
        services={checklist.services.map((s) => ({
          key: s.key,
          label: s.label,
          state: s.state,
        }))}
        billingLines={checklist.billing.lines}
        closeLine={checklist.close.line}
        readOnly={!view.canAct}
        dnsHandedBack={dnsHandedBack}
        stayHandedBackLine={STAY_HANDED_BACK}
      />
    </div>
  );
}
