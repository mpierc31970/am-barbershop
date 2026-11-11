// /staff/sites/<org>: one site (13-25 choice 4; STAFF-02, STAFF-05, P13-P23). requireStaff,
// `?tab=` against the site detail tabs, then the org id is validated through staffGetSite (a
// malformed or unknown id is a 404; any other read failure is logged by class name and the page
// still renders with the id as its title). The H1 is the business name. Panels:
// overview, addons, support, audit 13-33 · media 13-45 · indexing 13-39 · actions 13-43 ·
// domain 14-51 ("Domain · 1" from the shared staffDomainView read) · offboarding 14-43.
import { NotFound } from "@cds/core";
import { staffGetSite } from "@cds/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { StaffTabId } from "../../../sections";
import {
  StaffAreaPage,
  staffArea,
  type StaffPanel,
  type StaffSearchParams,
  type StaffSitePanelProps,
} from "../../StaffAreaPage";
import OverviewTab from "./panels/overview";
import AddonsTab from "./panels/addons";
import SupportTab from "./panels/support";
import MediaTab from "./panels/media";
import IndexingTab from "./panels/indexing";
import DomainTab, {
  readStaffDomainView,
  staffDomainAttention,
} from "./panels/domain";
import OffboardingTab from "./panels/offboarding";
import AuditTab from "./panels/audit";
import ActionsTab from "./panels/actions";

export const metadata: Metadata = { title: "Site" };

const ORG_ID = /^[a-z0-9]{15}$/;

export const dynamic = "force-dynamic";

const PANELS: Readonly<
  Record<StaffTabId<"sites">, StaffPanel<StaffSitePanelProps>>
> = {
  overview: OverviewTab,
  addons: AddonsTab,
  support: SupportTab,
  media: MediaTab,
  indexing: IndexingTab,
  domain: DomainTab,
  offboarding: OffboardingTab,
  audit: AuditTab,
  actions: ActionsTab,
};

export default async function StaffSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams?: Promise<StaffSearchParams>;
}) {
  const { org } = await params;
  const sp: StaffSearchParams = (await searchParams) ?? {};
  const { session, tab } = await staffArea("sites", sp.tab);
  // PocketBase ids: 15 lowercase letters/digits. Anything else is a 404 before any read.
  if (!ORG_ID.test(org)) notFound();
  let title = org;
  try {
    const site = await staffGetSite(session.ctx, org);
    title = site.name || org;
  } catch (err) {
    if (err instanceof NotFound) notFound();
    console.error(
      "[staff] site read failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  const Panel = PANELS[tab];
  // "Domain · 1" (14-51): a failed step or a pending override. The read is cached per request
  // and shared with the Domain panel; a failed read gives no count, never a wrong one.
  const domainCount = staffDomainAttention(
    await readStaffDomainView(session.ctx, org),
  );
  return (
    <StaffAreaPage
      section="sites"
      session={session}
      tab={tab}
      title={title}
      base={`/staff/sites/${org}`}
      counts={domainCount > 0 ? { "sites.domain": domainCount } : undefined}
    >
      {await Panel({ session, params: sp, orgId: org })}
    </StaffAreaPage>
  );
}
