// /staff/settings (13-25 choice 4; STAFF-05, D311, P13-P23; 13-UI-SPEC "Tabs"). requireStaff on
// the area feature (and the tab's own feature), `?tab=` parsed against STAFF_SECTIONS (unknown
// -> first tab), then the PANELS map. Panels: staff, demo, monitor 13-46.
import type { Metadata } from "next";
import type { StaffTabId } from "../../sections";
import {
  StaffAreaPage,
  staffArea,
  type StaffPanel,
  type StaffSearchParams,
} from "../StaffAreaPage";
import StaffTab from "./panels/staff";
import DemoTab from "./panels/demo";
import MonitorTab from "./panels/monitor";

export const metadata: Metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

const PANELS: Readonly<Record<StaffTabId<"settings">, StaffPanel>> = {
  staff: StaffTab,
  demo: DemoTab,
  monitor: MonitorTab,
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<StaffSearchParams>;
}) {
  const params: StaffSearchParams = (await searchParams) ?? {};
  const { session, tab } = await staffArea("settings", params.tab);
  const Panel = PANELS[tab];
  return (
    <StaffAreaPage section="settings" session={session} tab={tab}>
      {await Panel({ session, params })}
    </StaffAreaPage>
  );
}
