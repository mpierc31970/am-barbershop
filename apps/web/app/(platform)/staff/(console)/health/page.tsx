// /staff/health (13-25 choice 4; STAFF-05, D311, P13-P23; 13-UI-SPEC "Tabs"). requireStaff on
// the area feature (and the tab's own feature), `?tab=` parsed against STAFF_SECTIONS (unknown
// -> first tab), then the PANELS map. Panels: platform, premium, failsafe, jobs, media 13-45 · indexing 13-39.
import type { Metadata } from "next";
import type { StaffTabId } from "../../sections";
import {
  StaffAreaPage,
  staffArea,
  type StaffPanel,
  type StaffSearchParams,
} from "../StaffAreaPage";
import PlatformTab from "./panels/platform";
import PremiumTab from "./panels/premium";
import FailsafeTab from "./panels/failsafe";
import JobsTab from "./panels/jobs";
import MediaTab from "./panels/media";
import IndexingTab from "./panels/indexing";

export const metadata: Metadata = { title: "Health" };

export const dynamic = "force-dynamic";

const PANELS: Readonly<Record<StaffTabId<"health">, StaffPanel>> = {
  platform: PlatformTab,
  premium: PremiumTab,
  failsafe: FailsafeTab,
  jobs: JobsTab,
  media: MediaTab,
  indexing: IndexingTab,
};

export default async function HealthPage({
  searchParams,
}: {
  searchParams?: Promise<StaffSearchParams>;
}) {
  const params: StaffSearchParams = (await searchParams) ?? {};
  const { session, tab } = await staffArea("health", params.tab);
  const Panel = PANELS[tab];
  return (
    <StaffAreaPage section="health" session={session} tab={tab}>
      {await Panel({ session, params })}
    </StaffAreaPage>
  );
}
