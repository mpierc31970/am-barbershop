// Owner hub layout (CONT-08, D311, CONTEXT A2-Q1/A2-Q2; T-03-42). Every /hub request
// re-derives the session from the cookie; no session sends the visitor to /sign-in, so
// drafts and the hub are reachable only after sign-in. The ToastRegion sits here once
// (03-05) so toasts survive navigation between hub screens. The sidebar is composed here on
// the server from the session's role and grants and the org's active add-ons (05-11, D311).
// 06-18: the org's onboarding stage adds "Set up your site" (with the count of required
// items still needed) while the org is in setup; any read failure logs and the nav renders.
// 07-03: Inbox (content readers, with the unread count from inbox/unread.ts) and Marketing
// (contacts readers) items (D311, D-UI-P7-1).
// 09-19: the setup count adds the unsigned agreement through agreementSetupItem, the same
// pure rule the Setup panel uses (RESEARCH Pitfall 15); its status read is request-cached
// (getAgreementStatus) and wrapped so a failure never closes the hub (T-09-19-02).
// 10-22: the count adds "Pay and start your build" through checkoutSetupItem.
// 10-32 (BILL-03, BILL-09, D214, D310): a declined site's members get the declined notice in
// the focused frame instead of the hub (read first: it replaces the whole shell). Otherwise
// the Owner gets the billing banner (past due / paused) and, once after paying a lapse, the
// "add-ons are back on" toast. Both reads are guarded: a failure renders no banner.
// 11-16 (DASH-01, 18, 24, 27, 28): one getNeedsYou() per request feeds every sidebar badge
// (the Inbox badge too; the list's 20 cap is above the "9+" badge limit) and the Jump to
// index; a failure renders the hub with no badges. The setup count stays: it is pre-build
// (the Needs-you intake provider starts at being_built). The shell gets the person's sites,
// the Jump to index (hub hrefs only, T-11-16-02) and the profile head as plain props.
// 11-21 (DASH-34): the bell's first count comes from the same Needs-you keys (bellKeysFrom:
// failed providers and the capped inbox never clear an alert). Impersonating staff get no
// bell; a failed read shows the bell at 0 and its 60s refresh corrects it.
// 11-46 (DASH-17, DASH-28): Jump to also lists the help articles this person may read (the
// same grant-filtered index as the Help center; "Getting set up" only before launch).
// 12-14 (COMM-11, RESEARCH Open Q2, Pitfall 12): the service notices that reach this org come
// from activeServiceNotices with the active add-on list loaded above for the nav (no second
// add-on read) and the registry's add-on names; a failure renders no strip, never a broken hub.
// 14-42 (LIFE-01, D282): Owners and Admins get the Leaving CDS banner while a notice runs
// (offboardingView, guarded: a failed read renders no banner, never a broken hub).
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { can } from "@cds/core";
import { isHubHref } from "@cds/core/today";
import { addonIntakeFields, stillNeeded } from "@cds/core/intake";
import {
  activeAddons,
  activeServiceNotices,
  bellCounts,
  getIntakeSnapshot,
  getBusinessProfile,
  getOrgStage,
  getSeat,
  mySeatId,
  offboardingView,
  readCheckoutState,
  readDeclinedNotice,
  supportEmail,
  suspensionStatusFor,
  type DeclinedNotice as DeclinedNoticeData,
} from "@cds/db";
import type { ServiceNotice } from "@cds/core/support";
import { InlineAlert, ToastRegion } from "@cds/ui/hub";
import { BillingBanner } from "@cds/ui/hub/billing";
import type { SuspensionNoticeProps } from "@cds/ui/hub/shell";
import type { Metadata, Viewport } from "next";
import { HUB_THEME_COLOR } from "../../../lib/hub-pwa";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAgreementStatus } from "../../../lib/agreement-gate";
import {
  AGREEMENT_STAGES,
  agreementSetupItem,
  setupNeededCount,
  type AgreementSetupItem,
} from "../../../lib/agreement-setup";
import {
  CHECKOUT_STAGES,
  checkoutCountsAsRequired,
  checkoutSetupItem,
} from "../../../lib/checkout-setup";
import {
  billingBannerView,
  RESTORED_SEEN_COOKIE,
  restoredToastAt,
} from "../../../lib/billing-banner";
import { bellKeysFrom } from "../../../lib/bell";
import { buildHelpIndex, jumpHelpEntries } from "../../../lib/help-index";
import { getNeedsYou } from "../../../lib/needs-you";
import { PATH_HEADER } from "../../../lib/path-header";
import * as hubSession from "../../../lib/session";
import { DeclinedNotice } from "./DeclinedNotice";
import { HubShell } from "./HubShell";
import { roleLabel } from "./role-label";
import { RestoredToast } from "./RestoredToast";
import { buildJumpIndex } from "./jump-index";
import {
  ALL_NEEDS_YOU_FAILED,
  composeHubNav,
  inSetup,
  profileMenuLinks,
  type HubNeedsYou,
} from "./nav";
import { composeSectionTabs } from "./sections";

export const metadata: Metadata = {
  title: "Your site",
  robots: { index: false, follow: false },
  // 11-22 (DASH-34, D63): installable hub. The manifest link itself is rendered below with
  // crossOrigin="use-credentials" (metadata.manifest omits cookies, and the manifest is per
  // session org). iPhone reads these for Add to Home Screen.
  appleWebApp: { capable: true, statusBarStyle: "default" },
  icons: { apple: "/hub/icon/icon-180.png" },
};

/** 11-22: the installed hub's browser chrome colour (manifest theme_color). */
export const viewport: Viewport = { themeColor: HUB_THEME_COLOR };

export const dynamic = "force-dynamic";

/** Dev default until CDS_SUPPORT_EMAIL is set (GO-LIVE), same as the submit screen. */
const DEFAULT_SUPPORT_EMAIL = "support@connectionsdesignstudios.com";

export const DECLINED_LOAD_FAILED =
  "We couldn't load the details right now. Reload the page, or contact Support.";

/** 10-32: the focused declined frame for any member of a declined site (T-10-32-02). */
async function declinedFrame(
  session: hubSession.HubSession,
): Promise<ReactNode> {
  let notice: DeclinedNoticeData | null = null;
  let failed = false;
  try {
    notice = await readDeclinedNotice(session.ctx);
  } catch (err) {
    failed = true;
    console.error(
      "[hub] declined notice failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  if (!notice && !failed) redirect("/sign-in");
  const supportHref = `mailto:${supportEmail() ?? DEFAULT_SUPPORT_EMAIL}`;
  return (
    <ToastRegion>
      {/* 11-22: hoisted into <head> by React; credentials so the per-org manifest sees the session. */}
      <link
        rel="manifest"
        href="/hub/manifest.webmanifest"
        crossOrigin="use-credentials"
      />
      <HubShell
        businessName={session.org.name || "Your site"}
        siteUrl={null}
        email={session.email}
        nav={[]}
        pinned={[]}
        focused
      >
        {notice ? (
          <DeclinedNotice notice={notice} supportHref={supportHref} />
        ) : (
          <div className="mx-auto w-full max-w-[720px]">
            <InlineAlert tone="info">{DECLINED_LOAD_FAILED}</InlineAlert>
          </div>
        )}
      </HubShell>
    </ToastRegion>
  );
}

export default async function HubLayout({ children }: { children: ReactNode }) {
  const declined = await hubSession.getDeclinedSession();
  if (declined) return declinedFrame(declined);
  const session = await hubSession.requireHubSession();
  const host = session.org.primaryHost;
  const { ctx } = session;
  let active: string[] = [];
  try {
    active = await activeAddons(ctx);
  } catch (err) {
    // The hub still opens without add-on items; the add-on screens report their own errors.
    console.error("[hub] activeAddons failed", err);
  }
  let stage = "";
  let stillNeededCount = 0;
  try {
    stage = (await getOrgStage(ctx)).stage;
    if (inSetup(stage) && can(ctx, "business", "read")) {
      const snapshot = await getIntakeSnapshot(ctx);
      stillNeededCount = stillNeeded(
        snapshot,
        addonIntakeFields(ADDON_REGISTRY, snapshot.selections),
      ).required.length;
      let agreement: AgreementSetupItem = null;
      if (AGREEMENT_STAGES.includes(stage)) {
        try {
          agreement = agreementSetupItem(
            stage,
            await getAgreementStatus(ctx),
            ctx.role,
            Boolean(ctx.impersonator),
          );
          stillNeededCount = setupNeededCount(stillNeededCount, agreement);
        } catch (err) {
          // The agreement count is a hint too; /hub/setup reports its own state.
          console.error(
            "[hub] agreement status failed",
            err instanceof Error ? err.name : typeof err,
          );
        }
      }
      // 10-22: "Pay and start your build" counts while needed (same rule as the panel).
      if (CHECKOUT_STAGES.includes(stage) && can(ctx, "addons", "read")) {
        try {
          const item = checkoutSetupItem({
            stage,
            agreement,
            checkout: await readCheckoutState(ctx),
            role: ctx.role,
            impersonating: Boolean(ctx.impersonator),
          });
          if (checkoutCountsAsRequired(item)) stillNeededCount += 1;
        } catch (err) {
          console.error(
            "[hub] checkout state failed",
            err instanceof Error ? err.name : typeof err,
          );
        }
      }
    }
  } catch (err) {
    // The count is a hint: the hub still opens, and /hub/setup reports its own errors.
    console.error("[hub] setup state failed", err);
  }
  let needsYou: HubNeedsYou;
  try {
    needsYou = await getNeedsYou();
  } catch (err) {
    // Badges are hints: the hub still opens with none (every section counts as failed).
    console.error(
      "[hub] needs-you failed",
      err instanceof Error ? err.name : typeof err,
    );
    needsYou = { items: [], failed: ALL_NEEDS_YOU_FAILED };
  }
  // 10-32 choice 1: the path header gives the landing path. Only the pathname is passed: the
  // layout is kept across client navigation, so HubShell re-checks ?tab=billing and the
  // focused frames on the live URL (a landing on the Billing tab must not hide the banner on
  // the next screen). billingBannerView and restoredToastAt never throw.
  const path =
    ((await headers()).get(PATH_HEADER) ?? "/hub").split(/[?#]/, 1)[0] ??
    "/hub";
  const bannerView = await billingBannerView(ctx, path);
  const restoredKey = await restoredToastAt(
    ctx,
    (await cookies()).get(RESTORED_SEEN_COOKIE)?.value,
  );
  let alerts: { count: number; urgent: number } | null = null;
  if (!ctx.impersonator) {
    try {
      const c = await bellCounts(ctx, bellKeysFrom(needsYou));
      alerts = { count: c.unread, urgent: c.urgent };
    } catch (err) {
      console.error(
        "[hub] bell count failed",
        err instanceof Error ? err.name : typeof err,
      );
      alerts = { count: 0, urgent: 0 };
    }
  }
  let notices: ServiceNotice[] = [];
  try {
    notices = await activeServiceNotices(ctx, {
      activeAddons: active,
      addonNames: Object.fromEntries(
        ADDON_REGISTRY.list().map((m) => [m.slug, m.name]),
      ),
    });
  } catch (err) {
    // A notice is information: the hub still opens with no strip (T-12-14-02).
    console.error(
      "[hub] service notices failed",
      err instanceof Error ? err.name : typeof err,
    );
    notices = [];
  }
  // IN-C01: the strip's What happened dialog shows times in the business's own zone, the
  // same zone the Support pages and ticket detail use (UTC when the profile can't be read).
  // Read only when there is a notice to show.
  let noticeTimeZone = "UTC";
  if (notices.length > 0) {
    try {
      noticeTimeZone = (await getBusinessProfile(ctx)).time_zone || "UTC";
    } catch (err) {
      console.error(
        "[hub] notice time zone failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
  }
  // 13-22 (STAFF-22, D215, D218): the suspension notice under the top bar. Information only:
  // a failed read renders nothing and the hub still opens. Dates in the business zone.
  let suspension: SuspensionNoticeProps | null = null;
  try {
    const st = await suspensionStatusFor(ctx);
    if (st.state !== "none") {
      let zone = noticeTimeZone;
      if (notices.length === 0) {
        zone = (await getBusinessProfile(ctx)).time_zone || "UTC";
      }
      suspension = {
        state: st.state,
        ...(st.fixBy ? { fixBy: st.fixBy } : {}),
        ...(st.suspendedAt ? { suspendedAt: st.suspendedAt } : {}),
        timeZone: zone,
      };
    }
  } catch (err) {
    console.error(
      "[hub] suspension status failed",
      err instanceof Error ? err.name : typeof err,
    );
    suspension = null;
  }
  // 14-42: the Leaving CDS banner (Owner and Admin; Viewers and Editors see nothing new).
  let leaving: { days: number; next: string } | null = null;
  if (
    (ctx.role === "owner" || ctx.role === "admin") &&
    can(ctx, "offboarding", "read")
  ) {
    try {
      const off = await offboardingView(ctx);
      if (off?.status === "notice" && off.next) {
        leaving = { days: off.daysLeft, next: off.next };
      }
    } catch (err) {
      console.error(
        "[hub] leaving banner failed",
        err instanceof Error ? err.name : typeof err,
      );
      leaving = null;
    }
  }
  const navInput = {
    role: ctx.role,
    grants: ctx.grants,
    active,
    registry: ADDON_REGISTRY,
    needsYou,
  };
  const nav = composeHubNav({ ...navInput, stage, stillNeededCount });
  const jumpIndex = buildJumpIndex({
    nav,
    sections: composeSectionTabs({ ...navInput, nav: nav.items }),
    help: jumpHelpEntries(
      buildHelpIndex(ctx, active, { includeSetup: stage !== "live" }),
    ),
  }).filter((e) => isHubHref(e.href));
  const businessName = session.org.name || "Your site";
  // A&M fork: a barber seat's sidebar link opens their own public profile, not the site.
  // Anyone with their own seat (barbers, the owner) gets a profile menu of their own items.
  let profileUrl: string | null = null;
  const ownSeatId = session.impersonation
    ? null
    : await Promise.resolve()
        .then(() => mySeatId(ctx))
        .then((id) => id ?? null)
        .catch(() => null);
  if (host && ownSeatId && (ctx.role === "renter" || ctx.role === "staff")) {
    try {
      const seatId = ownSeatId;
      const seat = seatId ? await getSeat(ctx, seatId) : null;
      if (seat?.isPublished && seat.slug) {
        profileUrl = `https://${host}/barbers/${seat.slug}`;
      }
    } catch (err) {
      console.error(
        "[hub] seat lookup failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
  }
  const orgs = (session.orgs ?? []).map((o) => ({
    id: o.id,
    name: o.name || "Your site",
    role: roleLabel(o.role),
  }));
  return (
    <ToastRegion>
      <HubShell
        // P4 adds a logo from organization.design; until then the name stands in (UI-SPEC).
        businessName={businessName}
        siteUrl={profileUrl ?? (host ? `https://${host}` : null)}
        siteLabel={profileUrl ? "Visit profile" : undefined}
        email={session.email}
        nav={nav.items}
        pinned={nav.pinned}
        orgs={orgs}
        currentOrgId={session.org.id}
        jumpIndex={jumpIndex}
        profile={{
          name: session.email,
          email: "",
          roleLine: `${roleLabel(ctx.role)} at ${businessName}`,
          links: profileMenuLinks(ownSeatId, ctx.role),
          ...(ownSeatId ? { photoSeatId: ownSeatId } : {}),
        }}
        alerts={alerts}
        banner={bannerView ? <BillingBanner {...bannerView} /> : null}
        notices={notices}
        timeZone={noticeTimeZone}
        suspension={suspension}
        leaving={leaving}
        // 13-26 (STAFF-06): the CDS staff banner while staff view this site.
        impersonation={
          session.impersonation
            ? {
                business: session.impersonation.business || businessName,
                view: session.impersonation.view,
                reason: session.impersonation.reason,
                endsAt: session.impersonation.endsAt,
              }
            : null
        }
      >
        {children}
      </HubShell>
      <RestoredToast restoredKey={restoredKey} />
    </ToastRegion>
  );
}
