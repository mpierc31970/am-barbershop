// Settings (06-22; 06-UI-SPEC "Settings", "Hub shell changes"; D311, D312, PD-21; T-06-104,
// T-06-105). /hub/settings?tab=business|team-hours|email. ScreenHeader "Settings" + "?" (help
// id `settings.<tab>`; 11-47, DASH-17), the AutosaveStatus under it, TabLinks from
// HUB_SECTIONS (DASH-25; same filtering as `visible` below; the Email label carries the
// bouncing count, "Email · 1"), then the resolved tab's panel. Unknown tab -> Business info.
// Access follows the business feature: Owner and Admin edit, an Editor sees every field
// read-only with the info line, a Viewer or grant-only member gets a 404 (Settings is not in
// their nav either). Every read goes through the chokepoint with the session ctx; a failed
// panel load shows ERR-LOAD with Try again.
//
// Legal (09-20; AGR-06, AGR-07; CONTEXT A3-Q3; D82, D216): last tab, Owner and Admin only
// (`agreements:read`); hidden for an Editor, whose `?tab=legal` resolves to Business info
// (09-20 choice 2). "Legal · 1" when the terms are outdated or a site policy update waits;
// a failed count read counts 0 and is logged (T-09-20-03).
//
// Section 2 "Your site's policy pages" (09-23; AGR-08, D217): props built here from
// sitePolicyState + sitePolicyRows + sitePolicyNotices; publish and preview are the
// site-policies Server Actions (owner only at the chokepoint). A failed state read shows
// ERR-LOAD for that section only.
//
// Payments (10-25; BILL-06, PAY-03, PAY-10; CONTEXT A1; D285, D296, D311): before Legal, Owner
// and Admin only (`connect:read`); hidden for an Editor, whose `?tab=payments` resolves to
// Business info. The panel is StripeConnectPanel from readConnectStatus: the owner connects,
// Admin and impersonating staff read only (the actions refuse them too). "Payments · 1" from
// billingTabCounts when Stripe stopped after having been connected; a failed count read
// counts 0. `?connect=return` re-checks on the client; `?help=stripe` opens the how-to.
//
// Billing (10-29; BILL-03, BILL-08, BILL-13, BILL-16, BILL-19; CONTEXT A4; D82, D311): between
// Payments and Legal, Owner only (`billing:read`); hidden for Admin and below, whose
// `?tab=billing` resolves to Business info. The panel is built from mirrored rows only
// (buildBillingTabView, no provider call); impersonating staff see it read-only. "Billing · n"
// is the same billingTabCounts read as Payments (past due / paused plus quotes waiting).
// `?card=updated` shows Toast "Card updated." once.
//
// People & roles (11-39; DASH-22, DASH-25, DASH-27; D285): between Email and Payments, Owner
// and Admin (`members:read`); hidden for an Editor or Viewer, whose `?tab=people` resolves to
// Business info. The Owner manages; Admin and impersonating staff read only (PeoplePanel).
//
// Domain (14-31; DOM-02..05; D-UI-P14-1): after Email, Owner and Admin (`domain:read`); hidden
// for an Editor or Viewer, whose `?tab=domain` resolves to Business info. The Owner (or staff
// impersonating, audited) acts; an Admin reads (DOMAIN-ADMIN-READ, no buttons). "Domain · 1"
// from the same guarded ownerDomainView read (a failed read counts 0). `?view=records|email`
// loads ownerDnsRecords and the panel renders DNS records / email setup (14-32) once a CDS zone
// exists.
//
// Integrations (14-32; CONT-16, D190, D312; D-UI-P14-1): after Billing, Owner and Admin
// (`domain:read`), read-only; hidden for an Editor or Viewer, whose `?tab=integrations` resolves
// to Business info. NotLiveYet before launch, else GA4 / Search Console / Bing / IndexNow rows
// from ownerSearchStatus.
//
// Your data (11-41; LIFE-04; D285): the last section of Business info. The Owner asks for
// "Download my data"; Admin, Editor and impersonating staff see why they can't. A failed
// state read shows ERR-SECTION for that section only (the rest of the tab still renders).
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { can } from "@cds/core";
import {
  billingTabCounts,
  getBusinessProfile,
  getOrgStage,
  listAgreementDocuments,
  listEmailRoutes,
  listMedia,
  listTeam,
  ownerDnsRecords,
  ownerSearchStatus,
  paymentsMode,
  readAlertProfileFacts,
  readConnectStatus,
  sitePolicyState,
} from "@cds/db";
import { P14_COPY } from "@cds/core/dns";
import { InlineAlert, TabLinks, buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX } from "react";
import {
  loadEmailRouting,
  mediaView,
  teamMemberView,
} from "../../../../lib/intake";
import { getAgreementStatus } from "../../../../lib/agreement-gate";
import { AGREEMENT_STAGES } from "../../../../lib/agreement-setup";
import {
  SITE_POLICY_IMPERSONATING,
  SITE_POLICY_NOT_OWNER,
  agreementRows,
  agreementStrip,
  legalTabCount,
  sitePolicyNotices,
  sitePolicyRows,
} from "../../../../lib/legal-panel";
import { requireHubSession, type HubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { HUB_SECTIONS, settingsTabHelpId } from "../sections";
import { DomainPanel, readDomainView } from "./DomainPanel";
import { buildDomainView, domainTabCount } from "./domain-view";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { buildIntegrationsView } from "./integrations-view";
import { LegalPanel } from "./LegalPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import { peoplePanel } from "./PeoplePanel";
import { YourDataSection } from "./YourDataSection";
import { loadDataDownloadView } from "../../../../lib/data-download-view";
import { buildBillingTabView } from "../../../../lib/billing-view";
import { BillingPanel } from "./BillingPanel";
import { isCardUpdated } from "./billing-copy";
import {
  connectPanelView,
  isConnectHelp,
  isConnectReturn,
} from "./payments-view";
import type { SitePolicySectionProps } from "./SitePolicySection";
import {
  BusinessInfoPanel,
  EmailPanel,
  SettingsFrame,
  TeamHoursPanel,
} from "./SettingsPanels";
import {
  SETTINGS_TABS,
  resolveSettingsTab,
  reviewReturnHref,
  settingsTabHref,
  settingsTabLabel,
  type SettingsTabId,
} from "./tabs";

export const metadata: Metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type Ctx = HubSession["ctx"];

function LoadError({ tab }: { tab: SettingsTabId }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <Link
          href={settingsTabHref(tab)}
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

async function businessPanel(ctx: Ctx, readOnly: boolean) {
  const [profile, org, media, facts, yourData] = await Promise.all([
    getBusinessProfile(ctx),
    getOrgStage(ctx),
    listMedia(ctx),
    // 11-24: an outage here hides the switch; the rest of the tab still renders.
    readAlertProfileFacts(ctx).catch(() => null),
    // 11-41: an outage here shows ERR-SECTION in Your data only.
    loadDataDownloadView(ctx).catch((err: unknown) => {
      console.error(
        "[hub] settings your data: state read failed",
        err instanceof Error ? err.name : typeof err,
      );
      return null;
    }),
  ]);
  const logo = media
    .filter((m) => m.kind === "logo")
    .slice(0, 1)
    .map(mediaView);
  return (
    <>
      <BusinessInfoPanel
        profile={profile}
        path={org.path}
        logo={logo}
        readOnly={readOnly}
        sensitive={
          facts
            ? { on: facts.sensitiveOn, readOnly: Boolean(ctx.impersonator) }
            : null
        }
      />
      <YourDataSection initial={yourData} />
    </>
  );
}

async function teamHoursPanel(ctx: Ctx, readOnly: boolean) {
  const [profile, team, media] = await Promise.all([
    getBusinessProfile(ctx),
    listTeam(ctx),
    listMedia(ctx),
  ]);
  const views = media.map(mediaView);
  return (
    <TeamHoursPanel
      team={team.map((m) => teamMemberView(m, views))}
      hours={profile.hours}
      timeZone={profile.time_zone}
      readOnly={readOnly}
    />
  );
}

async function emailPanel(ctx: Ctx, readOnly: boolean) {
  const [profile, data] = await Promise.all([
    getBusinessProfile(ctx),
    loadEmailRouting(ctx),
  ]);
  return (
    <EmailPanel
      data={data}
      businessName={profile.orgName}
      readOnly={readOnly}
    />
  );
}

/** "https://<host>/privacy" on the org's primary host (live domain, else preview; choice 3). */
function policyHref(host: string | null, page: "privacy" | "terms") {
  return host ? `https://${host}/${page}` : null;
}

/** Section 2 props (09-23). Null when the state read failed (the section shows ERR-LOAD). */
async function sitePolicyProps(
  ctx: Ctx,
  host: string | null,
  timeZone: string | null,
): Promise<SitePolicySectionProps | null> {
  try {
    const state = await sitePolicyState(ctx, ADDON_REGISTRY);
    const impersonating = Boolean(ctx.impersonator);
    const canPublish = ctx.role === "owner" && !impersonating;
    const { alerts, ackedLine } = sitePolicyNotices(
      state,
      ctx.role,
      impersonating,
      timeZone,
    );
    return {
      rows: sitePolicyRows(state),
      notices: alerts,
      canPublish,
      readOnlyReason: canPublish
        ? null
        : impersonating
          ? SITE_POLICY_IMPERSONATING
          : SITE_POLICY_NOT_OWNER,
      published: state.published,
      updateWaiting: state.templateUpdateWaiting,
      ackedLine,
      missingInputs: state.missingInputs.length > 0,
      viewHrefs: {
        privacy: policyHref(host, "privacy"),
        terms: policyHref(host, "terms"),
      },
    };
  } catch (err) {
    console.error(
      "[hub] settings legal: site policy state failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  }
}

function SitePolicyLoadError() {
  return (
    <section
      aria-labelledby="legal-site-policies"
      className="flex flex-col gap-4"
    >
      <h2
        id="legal-site-policies"
        className="text-xl leading-tight font-semibold text-hub-ink"
      >
        Your site&apos;s policy pages
      </h2>
      <LoadError tab="legal" />
    </section>
  );
}

async function legalPanel(ctx: Ctx, _readOnly: boolean, host: string | null) {
  const [docs, status, profile, org] = await Promise.all([
    // Invoices list in the Billing tab (10-19); Legal shows signings only.
    listAgreementDocuments(ctx),
    getAgreementStatus(ctx),
    // Only the time zone comes from the profile: a failed read falls back to UTC rather
    // than hiding the agreements list (review IN-C04).
    getBusinessProfile(ctx).catch((err: unknown) => {
      console.error(
        "[settings] business profile read failed",
        err instanceof Error ? err.name : typeof err,
      );
      return null;
    }),
    getOrgStage(ctx),
  ]);
  const timeZone = profile?.time_zone || null;
  const sitePolicy = await sitePolicyProps(ctx, host, timeZone);
  const impersonating = Boolean(ctx.impersonator);
  const strip = agreementStrip(status, ctx.role, impersonating, timeZone);
  // No signings yet: Review and sign moves to the empty state, and only after Send to CDS
  // (09-UI-SPEC; 09-20 choice 4), so the section never shows the same action twice.
  const empty = docs.length === 0;
  const sent = AGREEMENT_STAGES.includes(org.stage);
  return (
    <LegalPanel
      strip={empty ? { ...strip, action: null } : strip}
      rows={agreementRows(docs, timeZone)}
      emptyAction={empty && sent ? strip.action : null}
      sitePolicy={sitePolicy}
      sitePolicies={sitePolicy ? undefined : <SitePolicyLoadError />}
    />
  );
}

function testMode(): boolean {
  try {
    return paymentsMode() === "fake";
  } catch {
    return false;
  }
}

/** Settings › Payments (10-25): the owner's own Stripe account, its state and fees. */
async function paymentsPanel(
  ctx: Ctx,
  _readOnly: boolean,
  _host: string | null,
  sp: SearchParams,
) {
  const status = await readConnectStatus(ctx);
  const view = connectPanelView(
    status,
    {
      role: ctx.role,
      impersonating: Boolean(ctx.impersonator),
      testMode: testMode(),
    },
    { now: new Date() },
  );
  return (
    <PaymentsPanel
      view={view}
      returning={isConnectReturn(sp.connect)}
      helpOpen={isConnectHelp(sp.help)}
    />
  );
}

/** Settings › Billing (10-29): plan, items, Care Plan, storage, quotes and invoices. */
async function billingPanel(
  ctx: Ctx,
  _readOnly: boolean,
  _host: string | null,
  sp: SearchParams,
) {
  const view = await buildBillingTabView(ctx, { registry: ADDON_REGISTRY });
  return <BillingPanel view={view} cardUpdated={isCardUpdated(sp.card)} />;
}

/** Settings › Domain (14-31): the owner domain view, one active section per state. */
async function domainPanel(
  ctx: Ctx,
  _readOnly: boolean,
  _host: string | null,
  sp: SearchParams,
) {
  const view = await readDomainView(ctx);
  const subView = domainSubView(sp.view);
  // 14-32: the DNS records / email setup views need the zone's records; none before a CDS
  // zone exists (null), which falls back to the normal Domain state.
  const records = subView ? await ownerDnsRecords(ctx) : null;
  return (
    <DomainPanel
      view={view}
      model={buildDomainView(view)}
      subView={subView}
      records={records}
      notice={domainNotice(sp.notice)}
    />
  );
}

/**
 * Settings › Integrations (14-32 choice 4): search engines and analytics, read-only. The
 * domain named before launch is the one being connected (a failed domain read leaves it out).
 */
async function integrationsPanel(ctx: Ctx) {
  const status = await ownerSearchStatus(ctx);
  let domain: string | null = null;
  if (!status.live) {
    try {
      domain = (await readDomainView(ctx)).domain ?? null;
    } catch (err) {
      console.error(
        "[hub] settings integrations domain read failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
  }
  return <IntegrationsPanel view={buildIntegrationsView(status, { domain })} />;
}

function domainSubView(raw: SearchParams[string]): "records" | "email" | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "records" || v === "email" ? v : null;
}

function domainNotice(raw: SearchParams[string]): "ns-not-yet" | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "ns-not-yet" ? v : null;
}

/** "Domain · 1" (14-31 choice 1); a failed read counts 0 so the tabs always open. */
async function domainCount(ctx: Ctx): Promise<number> {
  try {
    return domainTabCount(await readDomainView(ctx));
  } catch (err) {
    console.error(
      "[hub] settings domain count failed",
      err instanceof Error ? err.name : typeof err,
    );
    return 0;
  }
}

const PANELS: Readonly<
  Record<
    SettingsTabId,
    (
      ctx: Ctx,
      readOnly: boolean,
      host: string | null,
      sp: SearchParams,
    ) => Promise<JSX.Element>
  >
> = {
  business: businessPanel,
  "team-hours": teamHoursPanel,
  email: emailPanel,
  domain: domainPanel,
  people: peoplePanel,
  payments: paymentsPanel,
  billing: billingPanel,
  integrations: integrationsPanel,
  legal: legalPanel,
};

/**
 * "Payments · 1" (10-25) and "Billing · n" (10-29) from one billingTabCounts read; a failed
 * read counts 0 so the tabs always open.
 */
async function billingCounts(
  ctx: Ctx,
): Promise<{ payments: number; billing: number }> {
  try {
    const c = await billingTabCounts(ctx);
    return { payments: c.payments, billing: c.billing };
  } catch (err) {
    console.error(
      "[hub] settings payments/billing count failed",
      err instanceof Error ? err.name : typeof err,
    );
    return { payments: 0, billing: 0 };
  }
}

/** "Legal · 1" (09-20); each read is guarded so the tabs always open. */
async function legalCount(ctx: Ctx): Promise<number> {
  const [status, site] = await Promise.all([
    getAgreementStatus(ctx).catch((err: unknown) => {
      console.error("[hub] settings legal count: agreement status failed", err);
      return null;
    }),
    sitePolicyState(ctx, ADDON_REGISTRY).catch((err: unknown) => {
      console.error(
        "[hub] settings legal count: site policy state failed",
        err,
      );
      return null;
    }),
  ]);
  return legalTabCount(status, site);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx, org: site } = await requireHubSession();
  if (!can(ctx, "business", "read")) notFound();
  const sp = await searchParams;
  const canLegal = can(ctx, "agreements", "read");
  const canPayments = can(ctx, "connect", "read");
  const canBilling = can(ctx, "billing", "read");
  const canPeople = can(ctx, "members", "read");
  const canDomain = can(ctx, "domain", "read");
  const visible = (id: SettingsTabId) =>
    (id !== "legal" || canLegal) &&
    (id !== "people" || canPeople) &&
    (id !== "payments" || canPayments) &&
    (id !== "billing" || canBilling) &&
    (id !== "domain" || canDomain) &&
    (id !== "integrations" || canDomain);
  // WR-D06: Key facts "Edit" links come here with next=/hub/review?step=facts.
  const reviewReturn = reviewReturnHref(sp.next);
  const resolved = resolveSettingsTab(sp.tab);
  const tab: SettingsTabId = visible(resolved) ? resolved : "business";
  const readOnly = !can(ctx, "business", "write");

  let bouncing = 0;
  try {
    bouncing = (await listEmailRoutes(ctx)).filter(
      (r) => r.status === "bouncing",
    ).length;
  } catch (err) {
    // The tabs still open; the Email tab shows its own load error if routes stay down.
    console.error("[hub] listEmailRoutes failed", err);
  }

  const [legal, counts, domain] = await Promise.all([
    canLegal ? legalCount(ctx) : 0,
    canPayments || canBilling
      ? billingCounts(ctx)
      : { payments: 0, billing: 0 },
    canDomain ? domainCount(ctx) : 0,
  ]);

  let panel: JSX.Element;
  try {
    panel = await PANELS[tab](ctx, readOnly, site.primaryHost, sp);
  } catch (err) {
    console.error(`[hub] settings ${tab} failed`, err);
    panel = <LoadError tab={tab} />;
  }

  return (
    <SettingsFrame
      readOnly={readOnly}
      helpId={settingsTabHelpId(tab)}
      helpName={SETTINGS_TABS.find((t) => t.id === tab)?.label}
      tabBar={
        <TabLinks
          label="Settings sections"
          activeId={tab}
          tabs={HUB_SECTIONS.settings
            .tabs({
              role: ctx.role,
              grants: ctx.grants,
              active: [],
              registry: ADDON_REGISTRY,
            })
            .map((t) => ({
              id: t.id,
              label: settingsTabLabel(t.id as SettingsTabId, {
                email: bouncing,
                domain,
                legal,
                payments: counts.payments,
                billing: counts.billing,
              }),
              href: `?tab=${encodeURIComponent(t.id)}`,
            }))}
          LinkComponent={GuardedLink}
        />
      }
    >
      <div key={tab} className="flex flex-col gap-12">
        {reviewReturn ? (
          <p>
            <Link
              href={reviewReturn}
              className={buttonClasses("secondary", "sm")}
              data-review-return=""
            >
              {P14_COPY.BTN_BACK_TO_REVIEW}
            </Link>
          </p>
        ) : null}
        {panel}
      </div>
    </SettingsFrame>
  );
}
