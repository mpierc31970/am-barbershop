// /staff/review (13-25 choice 4; STAFF-05, D311, P13-P23; 13-UI-SPEC "Tabs"). requireStaff on
// the area feature (and the tab's own feature), `?tab=` parsed against STAFF_SECTIONS (unknown
// -> first tab), then the PANELS map. Panels: flags, spot, reports 13-38.
import type { Metadata } from "next";
import type { StaffTabId } from "../../sections";
import {
  StaffAreaPage,
  staffArea,
  type StaffPanel,
  type StaffSearchParams,
} from "../StaffAreaPage";
import FlagsTab from "./panels/flags";
import SpotTab from "./panels/spot";
import ReportsTab from "./panels/reports";

export const metadata: Metadata = { title: "Review queue" };

export const dynamic = "force-dynamic";

const PANELS: Readonly<Record<StaffTabId<"review">, StaffPanel>> = {
  flags: FlagsTab,
  spot: SpotTab,
  reports: ReportsTab,
};

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams?: Promise<StaffSearchParams>;
}) {
  const params: StaffSearchParams = (await searchParams) ?? {};
  const { session, tab } = await staffArea("review", params.tab);
  const Panel = PANELS[tab];
  return (
    <StaffAreaPage section="review" session={session} tab={tab}>
      {await Panel({ session, params })}
    </StaffAreaPage>
  );
}
