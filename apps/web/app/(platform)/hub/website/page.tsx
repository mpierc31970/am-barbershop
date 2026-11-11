// Website screen (D311, CONTEXT A2-Q1, A4-Q3; UI-SPEC "Hub shell" Website page, "Pages tab";
// 05-UI-SPEC "Hub shell changes"). ScreenHeader "Website" + "?" (help id `website.<tab>`;
// 11-47, DASH-17), the TabLinks bar from HUB_SECTIONS (DASH-25), then the resolved
// tab's panel. Tabs = Pages · Services · Media · Forms · Navigation · Footer · Banner · Pop-ups ·
// Site settings (D-UI-P7-2) + the org's installed add-on tabs in manifest
// order, composed on the server from the session's role and grants and the org's active
// add-ons (T-05-59). An unknown tab lands on the first tab; a bookmarked tab of a removed
// add-on lands there too, with an "is off" notice. The org comes only from the session.
// 10-32 (BILL-03, D27): when that add-on is paused by a billing lapse, the notice says
// PAUSED-TAB instead ("{Add-on} is paused because payment stopped. Pay from Settings ›
// Billing …", tabs.ts pausedTabCopy; warning, PauseCircle) and the Owner gets "Update card
// and pay".
// Panels: Pages (03-11), Services (06-22, the same ServicesSection as setup step 4; D37),
// Banner and Pop-ups (03-14), add-on tabs (05-12, AddonPanel). 07-03 registers the Media
// (07-17), Forms (07-18), Navigation and Footer (07-25) and Site settings (07-26) shells.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { can } from "@cds/core";
import type { AddonManifest } from "@cds/core/addons";
import { NAV_TOP_MAX } from "@cds/core/content";
import {
  RESERVED_SLUGS,
  activeAddons,
  getNav,
  getNotFoundPage,
  getOrgStage,
  listPages,
  listRecentlyDeleted,
  pagesUsage,
  pausedAddons,
  listServices,
  readBillingAccount,
  readPriceCatalog,
  type DeletedPage,
  type OrgContext,
  type PageSummary,
} from "@cds/db";
import { InlineAlert, TabLinks, buttonClasses } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { PauseCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GuardedLink } from "../GuardedLink";
import { HUB_SECTIONS } from "../sections";
import { pagesPackPriceLabel } from "../../../../lib/billing-view";
import { serviceView, type ServiceView } from "../../../../lib/intake";
import { CARD_HREF } from "../settings/billing-copy";
import { notFound } from "next/navigation";
import { requireHubSession } from "../../../../lib/session";
import { ServicesSection } from "../_intake/ServicesSection";
import { AddonPanel } from "./AddonPanel";
import { BannerTab } from "./BannerTab";
import { FooterTab } from "./FooterTab";
import { FormsTab } from "./FormsTab";
import { MediaTab } from "./MediaTab";
import { NavigationTab } from "./NavigationTab";
import { PagesTab } from "./PagesTab";
import type { PagesFullWho } from "./PagesFullPanel";
import { PopupsTab } from "./PopupsTab";
import { SiteSettingsTab } from "./SiteSettingsTab";
import { offCopy, pausedTabCopy, resolveTab, tabHref } from "./tabs";

export const metadata: Metadata = { title: "Website" };

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function LoadError({ tab }: { tab: string }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <Link href={tabHref(tab)} className={buttonClasses("secondary", "sm")}>
          Try again
        </Link>
      }
    >
      We couldn&apos;t load this. Check your connection and try again.
    </InlineAlert>
  );
}

/** Website › Services: the services list (business read; Owner and Admin edit). */
async function ServicesPanel() {
  const { ctx } = await requireHubSession();
  let services: ServiceView[];
  try {
    services = (await listServices(ctx)).map(serviceView);
  } catch (err) {
    console.error("[hub] listServices failed", err);
    return <LoadError tab="services" />;
  }
  return (
    <ServicesSection
      data={services}
      readOnly={!can(ctx, "business", "write")}
      context="website"
    />
  );
}

const PAUSED_BILLING: ReadonlySet<string> = new Set(["lapsed", "canceled"]);

/**
 * 11-28: who is looking, for the at-limit panel (UI-SPEC table). Only the Owner, signed in as
 * themselves, needs the billing state and the pack's catalog price; every read is guarded
 * (a failed read leaves the pack unpriced, so no buy button is offered on a guess).
 */
async function pagesWho(ctx: OrgContext): Promise<PagesFullWho> {
  const who: PagesFullWho = {
    role: ctx.role,
    impersonating: Boolean(ctx.impersonator),
    paused: false,
    unpriced: false,
    priceLabel: null,
  };
  if (who.impersonating || ctx.role !== "owner") return who;
  const [account, catalog, org] = await Promise.allSettled([
    readBillingAccount(ctx),
    readPriceCatalog(),
    getOrgStage(ctx),
  ]);
  if (account.status === "fulfilled") {
    who.paused = Boolean(
      account.value && PAUSED_BILLING.has(account.value.status),
    );
  } else console.error("[hub] pages: billing account read failed");
  if (catalog.status === "fulfilled" && org.status === "fulfilled") {
    who.priceLabel = pagesPackPriceLabel(catalog.value, org.value.path);
  } else console.error("[hub] pages: pack price read failed");
  who.unpriced = who.priceLabel === null;
  return who;
}

async function PagesPanel() {
  const { ctx } = await requireHubSession();
  let pages: PageSummary[];
  try {
    pages = await listPages(ctx);
  } catch (err) {
    console.error("[hub] listPages failed", err);
    return (
      <InlineAlert
        tone="error"
        action={
          <Link
            href={tabHref("pages")}
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
  // 07-25: the Add page menu checkbox needs the menu's size; a failed read disables it.
  let navTopCount = NAV_TOP_MAX;
  try {
    navTopCount = (await getNav(ctx))?.items.length ?? 0;
  } catch {
    console.error("[hub] getNav failed");
  }
  // 07-32: the system "Page not found" row (its own try/catch: a failure shows the
  // create-on-open form, which is idempotent).
  let notFoundPage: PageSummary | null = null;
  try {
    notFoundPage = await getNotFoundPage(ctx);
  } catch {
    console.error("[hub] getNotFoundPage failed");
  }
  // 11-28: the allowance counter and the at-limit panel (a failed read hides the count;
  // the server still refuses past the allowance).
  let usage: { used: number; allowance: number } | null = null;
  try {
    usage = await pagesUsage(ctx);
  } catch {
    console.error("[hub] pagesUsage failed");
  }
  // 11-30: Recently deleted, for members who can restore (content write; a Viewer would only
  // be refused). A failed read hides the section.
  let deleted: DeletedPage[] = [];
  if (can(ctx, "content", "write")) {
    try {
      const bin = await listRecentlyDeleted(ctx);
      if (Array.isArray(bin)) deleted = bin;
    } catch {
      console.error("[hub] listRecentlyDeleted failed");
    }
  }
  const who = await pagesWho(ctx);
  return (
    <PagesTab
      deleted={deleted}
      pages={pages}
      usage={usage}
      who={who}
      reserved={RESERVED_SLUGS}
      navTopCount={navTopCount}
      notFoundPage={notFoundPage}
      canEdit={can(ctx, "content", "write")}
    />
  );
}

type PanelFn = (searchParams: SearchParams) => Promise<React.JSX.Element>;

const PANELS: Readonly<Record<string, PanelFn>> = {
  pages: PagesPanel,
  services: ServicesPanel,
  media: MediaTab,
  forms: FormsTab,
  navigation: NavigationTab,
  footer: FooterTab,
  banner: BannerTab,
  popups: PopupsTab,
  site: SiteSettingsTab,
};

/** Add-ons that live as a tab under Website. */
function isWebsiteTab(m: AddonManifest): boolean {
  return m.nav.placement === "tab" && m.nav.item === "website";
}

export default async function WebsitePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireHubSession();
  const sp = await searchParams;
  let active: string[] = [];
  try {
    active = await activeAddons(ctx);
  } catch (err) {
    // The core tabs still open; a bookmarked add-on tab then reads as unknown.
    console.error("[hub] activeAddons failed", err);
  }
  const on = new Set(active);
  // HUB_SECTIONS is the one tab source (DASH-25): core tabs the role may read, then the
  // active add-ons whose tab sits under Website, each with its `website.<tab>` help id.
  const sectionTabs = HUB_SECTIONS.website.tabs({
    role: ctx.role,
    grants: ctx.grants,
    active,
    registry: ADDON_REGISTRY,
  });
  const tabs = sectionTabs.map((t) => ({ id: t.id, label: t.label }));
  // A&M fork: nothing here for this person (a barber seat): same as the sidebar, no Website.
  if (tabs.length === 0) notFound();
  // Only public add-ons that are off can explain a missing tab (no private-name oracle).
  const offSlugs = ADDON_REGISTRY.publicList()
    .filter((m) => isWebsiteTab(m) && !on.has(m.slug))
    .map((m) => m.slug);
  const { id: tab, fallbackFrom } = resolveTab(sp.tab, tabs, offSlugs);
  const off = fallbackFrom ? ADDON_REGISTRY.get(fallbackFrom) : undefined;
  let offPaused = false;
  if (off) {
    try {
      offPaused = (await pausedAddons(ctx)).includes(off.slug);
    } catch (err) {
      // The P5 "is off" wording stands in; the tab still resolves.
      console.error("[hub] pausedAddons failed", err);
    }
  }
  const canBrowse = can(ctx, "addons", "read");

  let panel: React.JSX.Element;
  if (tab === "") {
    panel = (
      <InlineAlert tone="info">
        Your role on this site can&apos;t see this. Ask the site owner.
      </InlineAlert>
    );
  } else if (Object.hasOwn(PANELS, tab)) {
    panel = await PANELS[tab]!(sp);
  } else {
    panel = await AddonPanel({ slug: tab });
  }

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title="Website"
        helpId={
          sectionTabs.find((t) => t.id === tab)?.helpId ??
          HUB_SECTIONS.website.helpId
        }
        helpName={sectionTabs.find((t) => t.id === tab)?.label ?? "Website"}
        LinkComponent={GuardedLink}
      />
      {tabs.length > 0 ? (
        <TabLinks
          label="Website sections"
          activeId={tab}
          tabs={tabs.map((t) => ({ ...t, href: tabHref(t.id) }))}
          LinkComponent={GuardedLink}
        />
      ) : null}
      {off && offPaused ? (
        <InlineAlert
          tone="warning"
          icon={PauseCircle}
          action={
            can(ctx, "billing", "read") ? (
              <a
                href={CARD_HREF}
                className={`${buttonClasses("secondary", "sm")} pointer-coarse:min-h-11`}
              >
                Update card and pay
              </a>
            ) : undefined
          }
        >
          {pausedTabCopy(off)}
        </InlineAlert>
      ) : off ? (
        <InlineAlert
          tone="info"
          action={
            canBrowse ? (
              <Link
                href={`/hub/add-ons/${encodeURIComponent(off.slug)}`}
                className={buttonClasses("secondary", "sm")}
              >
                Get add-ons
              </Link>
            ) : undefined
          }
        >
          {offCopy(off)}
        </InlineAlert>
      ) : null}
      <div>{panel}</div>
    </div>
  );
}
