// /hub: where a signed-in member lands (06-18; CONTEXT Area 3 hub placement, RESEARCH
// Pitfall 15; 06-UI-SPEC "Hub shell changes"). While the org is in intake or fit_review the
// owner goes to the setup overview; every other org (including an empty stage, i.e. a site
// that pre-dates onboarding) lands on Today; "Set up your site" stays in the sidebar through
// ready_for_build. The query
// string rides along, so ?notice=existing-owner (D286) reaches the screen that shows it.
// An unreadable stage falls back to Today rather than an error page. A member who can't
// read the business profile (a Viewer) has no setup screen, as in the sidebar, so they land
// on Today too (C-WR-06).
// 11-14 (DASH-30, D312): every stage past fit_review (and an empty stage) lands on Today,
// not Website; from being_built the still-needed intake items are Today's Needs-you rows.
// 09-19 (AGR-07, CONTEXT A3-Q1, D-UI-P9-19; 09-19 choice 3): an Admin whose org's terms are
// outdated lands with ?notice=terms-updated, so HubNotice shows MEMBER-OUTDATED as an info
// alert at the top of the landing screen ("Your site owner needs to accept them"). Owners
// never get here while outdated (the re-accept gate); Editors and Viewers see nothing. A
// notice already in the query wins (one notice at a time); a failed status read adds none.
import { can } from "@cds/core";
import { getOrgStage } from "@cds/db";
import { redirect } from "next/navigation";
import { getAgreementStatus } from "../../../lib/agreement-gate";
import {
  showMemberOutdated,
  TERMS_UPDATED_NOTICE,
} from "../../../lib/agreement-setup";
import { requireHubSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function queryOf(sp: SearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.append(k, v);
    else if (Array.isArray(v)) for (const one of v) q.append(k, one);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default async function HubIndex({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireHubSession();
  const sp: SearchParams = { ...(await searchParams) };
  if (ctx.role === "admin" && sp.notice === undefined) {
    try {
      if (showMemberOutdated(await getAgreementStatus(ctx), ctx.role)) {
        sp.notice = TERMS_UPDATED_NOTICE;
      }
    } catch (err) {
      console.error(
        "[hub] agreement status failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
  }
  const query = queryOf(sp);
  let stage = "";
  try {
    stage = (await getOrgStage(ctx)).stage;
  } catch (err) {
    console.error("[hub] getOrgStage failed", err);
  }
  if (
    (stage === "intake" || stage === "fit_review") &&
    can(ctx, "business", "read")
  ) {
    redirect(`/hub/setup${query}`);
  }
  // A&M fork: everyone lands on their Alerts list.
  redirect(`/hub/alerts${query}`);
}
