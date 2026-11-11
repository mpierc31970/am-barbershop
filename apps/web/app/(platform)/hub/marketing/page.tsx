// Marketing (CONTACTS-01; D311, 07-UI-SPEC "Hub shell changes (D311)", "Contacts",
// D-UI-P7-1; 07-03; T-07-03-01; 11-37 DASH-14..16, DASH-25). /hub/marketing?tab=contacts|social.
// ScreenHeader H1 "Marketing" + "?", the TabLinks bar from HUB_SECTIONS (one tab source), then
// the resolved tab's panel. Contacts follows contacts:read (Owner, Admin, staff, renter per
// MATRIX); Social follows content:read (Owner, Admin, Editor, Viewer; 11-37 choice 1). A tab
// the member may not read resolves to their first readable tab; a member with neither gets a
// 404 before anything renders. Hiding the sidebar item is presentation; this guard is the
// control. The org comes only from the session. A failed panel load shows ERR-LOAD.
// Add-on tabs placed under Marketing have no panel here yet, so the bar lists core tabs only.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { InlineAlert, TabLinks, buttonClasses } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX } from "react";
import { requireHubSession, type HubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { HUB_SECTIONS } from "../sections";
import { ContactsTab, type SearchParams } from "./ContactsTab";
import { SocialTab } from "./SocialTab";
import {
  marketingTabHref,
  readableMarketingTabs,
  resolveMarketingTab,
  type MarketingTabId,
} from "./tabs";

export const metadata: Metadata = { title: "Marketing" };

export const dynamic = "force-dynamic";

const PANELS: Readonly<
  Record<
    MarketingTabId,
    (searchParams: SearchParams, session: HubSession) => Promise<JSX.Element>
  >
> = {
  contacts: (sp) => ContactsTab(sp),
  social: (_sp, session) => SocialTab(session),
};

function LoadError({ tab }: { tab: MarketingTabId }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <Link
          href={marketingTabHref(tab)}
          className={buttonClasses("secondary", "sm")}
        >
          Try again
        </Link>
      }
    >
      We couldn&apos;t load this. Check your connection and try again.
    </InlineAlert>
  );
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireHubSession();
  const { ctx } = session;
  // A&M fork: barber seats see only their own setup (no Marketing, as in the sidebar).
  if (ctx.role === "renter" || ctx.role === "staff") notFound();
  const allowed = readableMarketingTabs(ctx);
  if (allowed.length === 0) notFound();
  const sp = await searchParams;
  const tab = resolveMarketingTab(sp.tab, allowed);

  const core = new Set<string>(allowed);
  const tabs = HUB_SECTIONS.marketing
    .tabs({
      role: ctx.role,
      grants: ctx.grants,
      active: [],
      registry: ADDON_REGISTRY,
    })
    .filter((t) => core.has(t.id));

  let panel: JSX.Element;
  try {
    panel = await PANELS[tab](sp, session);
  } catch (err) {
    console.error(`[hub] marketing ${tab} failed`, err);
    panel = <LoadError tab={tab} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title="Marketing"
        helpId={`marketing.${tab}`}
        helpName={tabs.find((t) => t.id === tab)?.label}
        LinkComponent={GuardedLink}
      />
      <TabLinks
        label="Marketing sections"
        activeId={tab}
        tabs={tabs.map((t) => ({
          id: t.id,
          label: t.label,
          href: `?tab=${encodeURIComponent(t.id)}`,
        }))}
        LinkComponent={GuardedLink}
      />
      <div key={tab}>{panel}</div>
    </div>
  );
}
