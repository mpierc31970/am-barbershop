// /hub/setup: the setup overview (06-18; 06-UI-SPEC "Setup overview"; ONB-02, ONB-03,
// D312, CONTEXT A3-Q4, A1-Q5). Loads everything in one chokepoint call and hands plain data
// to the SetupOverview island (Send to CDS, the collapsible still-needed list). A load
// failure shows ERR-LOAD with Try again. 11-47 (DASH-17): ScreenHeader with the "?" for the
// Set up your site how-to (help id `setup`), here and in SetupOverview.
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { loadStageData, type StageData } from "../../../../lib/intake";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { SetupOverview } from "./SetupOverview";

export const metadata: Metadata = { title: "Set up your site" };

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const { ctx } = await requireHubSession();
  let data: StageData;
  try {
    data = await loadStageData(ctx);
  } catch (err) {
    console.error("[setup] loadStageData failed", err);
    return (
      <div className="flex flex-col gap-6 font-hub">
        <ScreenHeader
          title="Set up your site"
          helpId="setup"
          helpName="setup"
          LinkComponent={GuardedLink}
        />
        <InlineAlert
          tone="error"
          action={
            <Link
              href="/hub/setup"
              className={buttonClasses("secondary", "sm")}
            >
              Try again
            </Link>
          }
        >
          We couldn&apos;t load this. Check your connection and try again.
        </InlineAlert>
      </div>
    );
  }
  return <SetupOverview data={data} />;
}
