// /staff/catalog (13-25 choice 4; STAFF-05, D311, P13-P23; 13-UI-SPEC "Tabs"). requireStaff on
// the area feature (and the tab's own feature), `?tab=` parsed against STAFF_SECTIONS (unknown
// -> first tab), then the PANELS map. Panels: addons, prices, announcement 13-37.
import type { Metadata } from "next";
import type { StaffTabId } from "../../sections";
import {
  StaffAreaPage,
  staffArea,
  type StaffPanel,
  type StaffSearchParams,
} from "../StaffAreaPage";
import AddonsTab from "./panels/addons";
import PricesTab from "./panels/prices";
import AnnouncementTab from "./panels/announcement";

export const metadata: Metadata = { title: "Catalog" };

export const dynamic = "force-dynamic";

const PANELS: Readonly<Record<StaffTabId<"catalog">, StaffPanel>> = {
  addons: AddonsTab,
  prices: PricesTab,
  announcement: AnnouncementTab,
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams?: Promise<StaffSearchParams>;
}) {
  const params: StaffSearchParams = (await searchParams) ?? {};
  const { session, tab } = await staffArea("catalog", params.tab);
  const Panel = PANELS[tab];
  return (
    <StaffAreaPage section="catalog" session={session} tab={tab}>
      {await Panel({ session, params })}
    </StaffAreaPage>
  );
}
