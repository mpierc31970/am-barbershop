// /staff/sites: the Sites list (13-25 choice 4; STAFF-02, P13-P23). requireStaff on the area
// feature; no tabs here (the site detail has them). The list panel (13-33, panels/list.tsx)
// reads @cds/db staffListSites with the URL filters.
import type { Metadata } from "next";
import { requireStaff } from "../../../../../lib/staff-session";
import { STAFF_SECTIONS } from "../../sections";
import {
  StaffAreaPage,
  type StaffPanel,
  type StaffSearchParams,
} from "../StaffAreaPage";
import ListTab from "./panels/list";

const ListPanel: StaffPanel = ListTab;

export const metadata: Metadata = { title: "Sites" };

export const dynamic = "force-dynamic";

export default async function SitesPage({
  searchParams,
}: {
  searchParams?: Promise<StaffSearchParams>;
}) {
  const params: StaffSearchParams = (await searchParams) ?? {};
  const session = await requireStaff(STAFF_SECTIONS.sites.feature);
  return (
    <StaffAreaPage section="sites" session={session}>
      {await ListPanel({ session, params })}
    </StaffAreaPage>
  );
}
