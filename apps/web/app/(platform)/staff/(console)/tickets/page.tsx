// /staff/tickets (13-25 choice 4; STAFF-05, D311, P13-P23; 13-UI-SPEC "Tabs"). requireStaff on
// the area feature (and the tab's own feature), `?tab=` parsed against STAFF_SECTIONS (unknown
// -> first tab), then the PANELS map. Panels: inbox 13-35 · incidents, windows, ideas 13-36 · canned 13-41 · ratings 13-42.
import type { Metadata } from "next";
import type { StaffTabId } from "../../sections";
import {
  StaffAreaPage,
  staffArea,
  type StaffPanel,
  type StaffSearchParams,
} from "../StaffAreaPage";
import InboxTab from "./panels/inbox";
import IncidentsTab from "./panels/incidents";
import WindowsTab from "./panels/windows";
import IdeasTab from "./panels/ideas";
import CannedTab from "./panels/canned";
import RatingsTab from "./panels/ratings";

export const metadata: Metadata = { title: "Tickets" };

export const dynamic = "force-dynamic";

const PANELS: Readonly<Record<StaffTabId<"tickets">, StaffPanel>> = {
  inbox: InboxTab,
  incidents: IncidentsTab,
  windows: WindowsTab,
  ideas: IdeasTab,
  canned: CannedTab,
  ratings: RatingsTab,
};

export default async function TicketsPage({
  searchParams,
}: {
  searchParams?: Promise<StaffSearchParams>;
}) {
  const params: StaffSearchParams = (await searchParams) ?? {};
  const { session, tab } = await staffArea("tickets", params.tab);
  const Panel = PANELS[tab];
  return (
    <StaffAreaPage section="tickets" session={session} tab={tab}>
      {await Panel({ session, params })}
    </StaffAreaPage>
  );
}
