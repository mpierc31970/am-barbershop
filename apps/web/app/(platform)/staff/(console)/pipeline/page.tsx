// /staff/pipeline (13-25 choice 4; STAFF-05, D311, P13-P23; 13-UI-SPEC "Tabs"). requireStaff on
// the area feature (and the tab's own feature), `?tab=` parsed against STAFF_SECTIONS (unknown
// -> first tab), then the PANELS map. Panels: leads, fit, building, polish, launch 13-34.
import type { Metadata } from "next";
import type { StaffTabId } from "../../sections";
import {
  StaffAreaPage,
  staffArea,
  type StaffPanel,
  type StaffSearchParams,
} from "../StaffAreaPage";
import LeadsTab from "./panels/leads";
import FitTab from "./panels/fit";
import BuildingTab from "./panels/building";
import PolishTab from "./panels/polish";
import LaunchTab from "./panels/launch";

export const metadata: Metadata = { title: "Pipeline" };

export const dynamic = "force-dynamic";

const PANELS: Readonly<Record<StaffTabId<"pipeline">, StaffPanel>> = {
  leads: LeadsTab,
  fit: FitTab,
  building: BuildingTab,
  polish: PolishTab,
  launch: LaunchTab,
};

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: Promise<StaffSearchParams>;
}) {
  const params: StaffSearchParams = (await searchParams) ?? {};
  const { session, tab } = await staffArea("pipeline", params.tab);
  const Panel = PANELS[tab];
  return (
    <StaffAreaPage section="pipeline" session={session} tab={tab}>
      {await Panel({ session, params })}
    </StaffAreaPage>
  );
}
