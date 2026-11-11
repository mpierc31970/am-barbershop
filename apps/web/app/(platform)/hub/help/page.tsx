// Help center (11-46; DASH-17, D110, D208; 11-UI-SPEC "Help center" lines 592-601). Pinned
// Help opens it. The list is built here on the server per person (lib/help-index.ts:
// core + active add-ons' training + help extras, filtered by role and add-on grants,
// T-11-46-01), so the client search only narrows what the person may already read. "Getting
// set up" is listed only before launch. A failed add-on or stage read still renders the core
// articles.
import { getOrgStage, activeAddons } from "@cds/db";
import { HELP_COPY, HelpCenter, type HelpCenterGroup } from "@cds/ui/hub/help";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import {
  HELP_GROUP_LABEL,
  buildHelpIndex,
  helpSearchText,
  type HelpGroup,
} from "../../../../lib/help-index";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";

export const metadata: Metadata = { title: "Help" };

export const dynamic = "force-dynamic";

const GROUPS: readonly HelpGroup[] = ["addons", "site", "setup"];

export default async function HelpCenterPage() {
  const { ctx } = await requireHubSession();
  let active: string[] = [];
  try {
    active = await activeAddons(ctx);
  } catch (err) {
    console.error(
      "[hub] help add-ons failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  let live = false;
  try {
    live = (await getOrgStage(ctx)).stage === "live";
  } catch (err) {
    console.error(
      "[hub] help stage failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  const index = buildHelpIndex(ctx, active, { includeSetup: !live });
  const groups: HelpCenterGroup[] = GROUPS.map((key) => ({
    key,
    label: HELP_GROUP_LABEL[key],
    entries: index
      .filter((e) => e.group === key)
      .map((e) => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        href: e.href,
        searchText: helpSearchText(e),
      })),
  })).filter((g) => g.entries.length > 0);

  return (
    <div
      className="flex w-full max-w-[720px] flex-col gap-6 font-hub text-hub-ink"
      data-help-screen=""
    >
      <ScreenHeader
        title={HELP_COPY.title}
        helpId="help"
        LinkComponent={GuardedLink}
      />
      <HelpCenter groups={groups} LinkComponent={GuardedLink} />
    </div>
  );
}
