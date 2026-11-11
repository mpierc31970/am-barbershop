// One console area frame (13-25 choices 3, 4; STAFF-05, D311, P13-P23; 13-UI-SPEC "Tabs"):
// the area H1, its "?" (only when the area's how-to exists in STAFF_HELP, P13-P12, so nothing
// points at a missing article), TabLinks from STAFF_SECTIONS (`?tab=`, unknown -> first tab),
// then the tab's panel. Area pages call `staffArea(section, rawTab)` for the guard + tab, then
// dispatch through their PANELS map. Panel modules are owned by later plans (brief "Console
// page seams"); nobody else edits an area page.tsx.
import { STAFF_HELP } from "@cds/addon-registry/staff-help";
import { TabLinks } from "@cds/ui/hub";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  requireStaff,
  staffCan,
  type StaffWebSession,
} from "../../../../lib/staff-session";
import {
  STAFF_SECTIONS,
  parseStaffTab,
  staffTabLinks,
  type StaffCounts,
  type StaffSectionDef,
  type StaffSectionKey,
  type StaffTabId,
} from "../sections";
import { StaffHelpDrawer } from "./StaffHelpDrawer";

export type StaffSearchParams = Record<string, string | string[] | undefined>;

/** What every area panel receives. */
export type StaffPanelProps = {
  session: StaffWebSession;
  params: StaffSearchParams;
};

/** Site detail panels also get the org id (validated by the page). */
export type StaffSitePanelProps = StaffPanelProps & { orgId: string };

export type StaffPanel<P = StaffPanelProps> = (props: P) => Promise<ReactNode>;

/**
 * The area guard: requireStaff(area feature) (signed out -> sign-in with `next`, never-allowed
 * role -> 404), the parsed tab, and requireStaff(tab feature) when the tab has its own.
 */
export async function staffArea<S extends StaffSectionKey>(
  section: S,
  rawTab: unknown,
): Promise<{ session: StaffWebSession; tab: StaffTabId<S> }> {
  const def = STAFF_SECTIONS[section] as StaffSectionDef;
  const session = await requireStaff(def.feature);
  const tab = parseStaffTab(section, rawTab);
  const tabDef = def.tabs.find((t) => t.id === tab);
  if (tabDef?.feature) await requireStaff(tabDef.feature);
  return { session, tab };
}

export interface StaffAreaPageProps {
  section: StaffSectionKey;
  session: StaffWebSession;
  /** The current tab; omit on areas without tabs (Today, the Sites list). */
  tab?: string;
  /** H1 when it is not the area label (the site detail shows the business name). */
  title?: string;
  /** Tab link base (`/staff/sites/<org>` on the site detail). */
  base?: string;
  /** Neutral tab count suffixes (13-47). */
  counts?: StaffCounts["tabs"];
  /** Right-aligned header actions. */
  actions?: ReactNode;
  children?: ReactNode;
}

export function StaffAreaPage({
  section,
  session,
  tab,
  title,
  base,
  counts,
  actions,
  children,
}: StaffAreaPageProps) {
  const def = STAFF_SECTIONS[section] as StaffSectionDef;
  const heading = title ?? def.label;
  const article = STAFF_HELP[def.helpSlug];
  const allowed = new Set(
    def.tabs
      .filter((t) => !t.feature || staffCan(session.role, t.feature))
      .map((t) => t.id as string),
  );
  const tabs = tab
    ? staffTabLinks(section, { base, counts }).filter((t) => allowed.has(t.id))
    : [];
  return (
    <div className="flex flex-col gap-6 font-hub text-hub-ink">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="text-[28px] leading-[1.2] font-semibold">{heading}</h1>
          {article ? (
            <StaffHelpDrawer name={def.label} article={article} />
          ) : null}
        </div>
        {actions ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {tabs.length > 0 && tab ? (
        <TabLinks
          tabs={tabs}
          activeId={tab}
          label={`${def.label} sections`}
          LinkComponent={Link}
        />
      ) : null}
      <div>{children}</div>
    </div>
  );
}
