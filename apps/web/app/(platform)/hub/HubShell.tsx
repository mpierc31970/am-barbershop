"use client";
// Owner hub shell (D311 DCR admin pattern, donor Sidebar.tsx L20-67 / L112-114; UI-SPEC
// "Hub shell" and "Header"; D63, DASH-09: no CDS marks). At 1024px and up: a fixed 256px
// sidebar on hub-surface-2 with the business name, View site, one flat nav list and the
// pinned block (Get add-ons, Help, CDS Support), plus the 56px top bar in the content column
// (D-UI-P11-2): org switcher, Jump to, bell slot, profile menu. Below 1024px the same top bar
// is the phone header (Open menu, name or switcher, Jump to, bell, profile; D-UI-P11-3) and
// "Open menu" opens the sidebar in a left Drawer: focus starts on the first nav link, Esc,
// backdrop and nav click close it, focus returns to Open menu (DASH-29).
// The nav is composed on the server (nav.ts: role, grants, active add-ons, Needs-you badges)
// and arrives as plain data; icon keys map to lucide components through a closed map here.
// Items not built yet are absent, never greyed out. The signed-in email and Sign out live in
// the profile menu (D-UI-P11-5). Nav links, Jump to, the org switch and Sign out ask the hub
// navigation guard first, so unsaved builder edits get the builder's save dialog instead of
// being dropped (WR-B05). The CDS Support row is the only shell element that names CDS; it
// carries data-cds-identity (DASH-09, neutral-chrome test).
// 11-21: the top bar's bell is HubBell (AlertBell + AlertsPanel), seeded with the layout's
// `alerts` count; impersonating staff and the focused frames get no bell.
// 11-47: standard and builder screens sit inside HelpDrawerHost, so every ScreenHeader "?"
// opens its how-to in the TrainingDrawer in place (`?help=<id>`; DASH-17).
// 12-14 (COMM-11, D99-D101): the CDS service notice strip sits under the top bar, above
// <main>, in one place both the standard and builder branches share (not in bare preview or
// the focused frame). The layout passes every notice that reaches the org; the strip keeps
// page and component notices to their own screens on the live path (noticesForPath).
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import type { ServiceNotice } from "@cds/core/support";
import { Button, Drawer, buttonClasses, useToast } from "@cds/ui/hub";
import { ImpersonationBanner } from "@cds/ui/hub/cds";
import { LeavingBanner } from "@cds/ui/hub/leaving";
import { ServiceNoticeStrip } from "@cds/ui/hub/support";
import {
  SHELL_COPY,
  TopBar,
  type JumpEntry,
  type ShellOrg,
  SuspensionNotice,
  type SuspensionNoticeProps,
} from "@cds/ui/hub/shell";
import {
  BadgeCheck,
  Bell,
  CalendarClock,
  ChartColumn,
  CircleHelp,
  ExternalLink,
  Globe,
  House,
  Inbox,
  LifeBuoy,
  ListChecks,
  LogOut,
  Megaphone,
  MessageSquareQuote,
  PackagePlus,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  startTransition,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { dismissNoticeAction } from "../../actions/notices";
import { switchOrgAction } from "../../actions/session";
import { endImpersonationAction } from "../../actions/staff/impersonation";
import type { NavIconKey } from "@cds/core/addons";
import { bannerSuppressed } from "../../../lib/billing-banner-path";
import { GuardedLink } from "./GuardedLink";
import { HelpDrawerHost } from "./HelpDrawerHost";
import { HubBell } from "./HubBell";
import { HubFlash } from "./HubFlash";
import { HubNotice } from "./HubNotice";
import { INBOX_NAV, SETUP_NAV, SUPPORT_NAV, type HubNavItem } from "./nav";
import { NavGuardProvider, isPlainLeftClick, useNavGuard } from "./nav-guard";
import { signOutThisBrowser } from "../../../lib/sign-out-browser";

type IconComponent = ComponentType<{
  size?: number;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
}>;

/** Closed icon map: an unknown key draws no icon (never a lookup off the prototype). */
const NAV_ICONS: Readonly<Record<NavIconKey, IconComponent>> = {
  Globe,
  PackagePlus,
  MessageSquareQuote,
  BadgeCheck,
  ListChecks,
  Settings,
  Inbox,
  Megaphone,
  House,
  ChartColumn,
  CircleHelp,
  LifeBuoy,
  Bell,
  CalendarClock,
};

function iconFor(key: string): IconComponent | null {
  return Object.hasOwn(NAV_ICONS, key) ? NAV_ICONS[key as NavIconKey] : null;
}

/** The content landmark the skip link targets. */
export const HUB_MAIN_ID = "hub-main";

/**
 * How the content area is framed. The page builder uses the full width (UI-SPEC "Hub
 * chrome"), and the draft preview renders full-bleed without hub chrome (UI-SPEC
 * "Preview"), so its strip and the site theme own the whole screen. Re-accept (09-UI-SPEC
 * "Re-accept", D-UI-P9-3) is "focused": the header only, no sidebar, no menu drawer,
 * because every sidebar link would only bounce back to the agreement.
 */
export function contentMode(
  pathname: string,
  search?: Pick<URLSearchParams, "get"> | null,
): "standard" | "builder" | "bare" | "focused" {
  if (/^\/hub\/agreement\/?$/.test(pathname)) {
    return search?.get("mode") === "reaccept" ? "focused" : "standard";
  }
  const m = /^\/hub\/website\/pages\/[^/]+(\/preview)?\/?$/.exec(pathname);
  if (!m) return "standard";
  return m[1] ? "bare" : "builder";
}

function isActive(pathname: string, href: string): boolean {
  const path = href.split("?")[0] ?? href;
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Badge text: "9+" above nine (UI-SPEC "Badges"). */
export function badgeText(n: number): string {
  return n > 9 ? "9+" : String(n);
}

/** The badge's screen-reader suffix, named by its item (UI-SPEC "Badges"). */
function badgeSuffix(href: string): string {
  if (href === SETUP_NAV.href) return "still needed";
  if (href === INBOX_NAV.href) return "unread";
  return "need you";
}

export interface HubShellProfile {
  name: string;
  email: string;
  /** "Owner at Rivera Bakery" */
  roleLine?: string;
}

export interface HubShellProps {
  businessName: string;
  /** https://<primary host>, or null when the site has no host yet. */
  siteUrl: string | null;
  /** The sidebar link's words (A&M fork: a barber gets "Visit profile"); default "View site". */
  siteLabel?: string;
  email: string;
  /** Server-composed sidebar items (nav.ts). */
  nav: readonly HubNavItem[];
  /** Pinned rows (11-14): "Get add-ons" for Owner/Admin, then Help and CDS Support. */
  pinned: readonly HubNavItem[];
  /** The person's active sites (switcher; 11-11). Absent: the current site only. */
  orgs?: readonly ShellOrg[];
  currentOrgId?: string;
  /** Server-built, grant-filtered Jump to index (hub hrefs only; 11-14). */
  jumpIndex?: readonly JumpEntry[];
  /** Profile menu head. Absent: the signed-in email. */
  profile?: HubShellProfile;
  /** Bell slot override (tests). Absent: HubBell (AlertBell + AlertsPanel) from `alerts`. */
  bell?: ReactNode;
  /**
   * 11-21: the bell's first count from the layout (same Needs-you keys as the badges). Absent
   * or null (impersonating staff, focused frames): no bell.
   */
  alerts?: { count: number; urgent: number } | null;
  /**
   * 10-32: the owner billing banner (server-rendered BillingBanner), or null. Shown at the
   * top of the standard content area; hidden on Settings › Billing and the focused frames,
   * re-checked here on the live path because the layout is kept across client navigation.
   */
  banner?: ReactNode;
  /** 10-32: force the focused frame on every path (the declined notice, D-UI-P10-19). */
  focused?: boolean;
  /**
   * 12-14: every service notice that reaches the org (activeServiceNotices; [] on a failed
   * read). Filtered here by the live path.
   */
  notices?: readonly ServiceNotice[];
  /** 12-14: business time zone for the notice's What happened box. */
  timeZone?: string;
  /**
   * 13-22 (STAFF-22): the site's suspension state (suspensionStatusFor), or null. Shown under
   * the top bar above the service notices, and in the focused frame; never dismissible.
   */
  suspension?: SuspensionNoticeProps | null;
  /**
   * 13-26 (STAFF-06, P13-P4): set while CDS staff view this site. The ImpersonationBanner
   * then sits above the top bar (and the focused frame's header) on every hub screen.
   */
  impersonation?: HubImpersonationView | null;
  /**
   * 14-42 (LIFE-01): the running Leaving CDS notice (offboardingView: days left and the next
   * step in banner words), or null. Owners and Admins only; never in the focused frame.
   */
  leaving?: { days: number; next: string } | null;
  children: ReactNode;
}

/** The banner facts the layout passes when the session is a staff view (13-26). */
export type HubImpersonationView = {
  business: string;
  view: "admin" | "owner";
  reason: string;
  endsAt: string;
};

function NavRow({
  item,
  pathname,
  onNavigate,
}: {
  item: HubNavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const navGuard = useNavGuard();
  const active = isActive(pathname, item.href);
  const Icon = iconFor(item.iconKey);
  const identity = item.href === SUPPORT_NAV.href;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      data-cds-identity={identity ? "" : undefined}
      onClick={(e) => {
        // A modifier or middle click opens a new tab: this tab stays put,
        // so no leave dialog and no drawer close (IN-R05).
        if (!isPlainLeftClick(e)) return;
        // Close the drawer either way, so the save dialog is not behind it.
        onNavigate?.();
        if (navGuard.intercept(() => router.push(item.href))) {
          e.preventDefault();
        }
      }}
      className={
        "flex min-h-11 items-center gap-3 rounded px-3 text-base transition-colors duration-150 " +
        (active
          ? "bg-hub-accent-tint font-semibold text-hub-accent"
          : "text-hub-ink hover:bg-hub-surface")
      }
    >
      {Icon ? <Icon aria-hidden size={20} strokeWidth={2} /> : null}
      <span className="flex-1">{item.label}</span>
      {item.badge ? (
        // Neutral count (UI-SPEC "Badges"): the item's Needs-you items.
        <span className="rounded bg-hub-surface px-2 py-1 text-sm leading-none font-semibold text-hub-ink tabular-nums">
          {badgeText(item.badge)}
          <span className="sr-only"> {badgeSuffix(item.href)}</span>
        </span>
      ) : null}
    </Link>
  );
}

function Sidebar({
  businessName,
  siteUrl,
  siteLabel,
  nav,
  pinned,
  onNavigate,
}: Pick<
  HubShellProps,
  "businessName" | "siteUrl" | "siteLabel" | "nav" | "pinned"
> & {
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "";
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex flex-col items-start gap-4">
        {/* No logo field yet: the business name stands in (UI-SPEC "Sidebar" 1). */}
        <p className="text-xl leading-tight font-semibold text-balance text-hub-ink">
          {businessName}
        </p>
        {siteUrl ? (
          <a
            href={siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses("secondary", "sm")}
          >
            <ExternalLink aria-hidden size={16} strokeWidth={2} />
            <span>{siteLabel ?? SHELL_COPY.viewSite}</span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
      <nav aria-label="Hub" className="flex-1">
        <ul className="flex flex-col gap-1">
          {nav.map((item) => (
            <li key={item.href}>
              <NavRow item={item} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>
      {pinned.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-hub-border pt-4">
          {pinned.map((item) => (
            <li key={item.href}>
              <NavRow item={item} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The focused frame (09-UI-SPEC "Re-accept", D-UI-P9-3): a 56px header with the business
 * name, the signed-in email and Sign out; no sidebar, no menu drawer, no top bar. The page
 * sets its own 720px column. No navigation guard: there is nothing unsaved to protect here.
 */
function FocusedFrame({
  businessName,
  email,
  suspension = null,
  impersonation = null,
  onExpire,
  children,
}: {
  businessName: string;
  email: string;
  suspension?: SuspensionNoticeProps | null;
  impersonation?: HubImpersonationView | null;
  onExpire?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-hub-surface font-hub text-hub-ink">
      {impersonation ? (
        <ImpersonationBanner
          {...impersonation}
          endAction={endImpersonationAction}
          onExpire={onExpire}
        />
      ) : null}
      <header
        className={`sticky ${impersonation ? "top-10" : "top-0"} z-20 flex h-14 items-center gap-4 border-b border-hub-border bg-hub-surface-2 px-4 sm:px-8`}
      >
        <p className="min-w-0 flex-1 truncate text-base font-semibold">
          {businessName}
        </p>
        <p
          className="hidden max-w-[240px] truncate text-sm text-hub-ink-muted sm:block"
          title={email}
        >
          {email}
        </p>
        <form action={signOutThisBrowser}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            icon={<LogOut aria-hidden size={16} strokeWidth={2} />}
          >
            Sign out
          </Button>
        </form>
      </header>
      {suspension ? <SuspensionNotice {...suspension} /> : null}
      <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8">
        {children}
      </main>
    </div>
  );
}

/**
 * The top bar wired to the app: Jump to, the org switch and Sign out each run through the
 * hub navigation guard (a dirty builder asks first). A refused switch shows ERR-SWITCH.
 */
function ShellTopBar({
  orgs,
  currentOrgId,
  jumpIndex,
  profile,
  bell,
  onOpenMenu,
}: {
  orgs: readonly ShellOrg[];
  currentOrgId: string;
  jumpIndex: readonly JumpEntry[];
  profile: HubShellProfile;
  bell?: ReactNode;
  onOpenMenu: () => void;
}) {
  const router = useRouter();
  const navGuard = useNavGuard();
  const toast = useToast();
  /** Runs `go` now, or lets the registered screen run it after its save dialog. */
  const guarded = (go: () => void): boolean => {
    if (navGuard.intercept(go)) return true;
    go();
    return false;
  };
  const runSwitch = async (id: string): Promise<void> => {
    // Success redirects to /hub/today inside the action (11-11); a refusal is { ok: false }.
    const result = await switchOrgAction(id);
    if (result && result.ok === false) {
      toast.show({ message: SHELL_COPY.errSwitch });
      throw new Error("switch refused");
    }
  };
  return (
    <TopBar
      orgs={orgs}
      currentOrgId={currentOrgId}
      onSwitch={(id) => {
        const run: { pending?: Promise<void> } = {};
        const tookOver = guarded(() => {
          run.pending = runSwitch(id);
          // A later run (after the builder's dialog) has no caller to report to.
          run.pending.catch(() => {});
        });
        // The builder's dialog runs the switch later; clear "Switching…" now.
        if (tookOver || !run.pending) {
          return Promise.reject(new Error("deferred"));
        }
        return run.pending;
      }}
      jumpIndex={jumpIndex}
      onNavigate={(href) => {
        guarded(() => router.push(href));
      }}
      bell={bell}
      profile={{
        ...profile,
        onSignOut: () => {
          guarded(() =>
            startTransition(async () => {
              await signOutThisBrowser();
            }),
          );
        },
        // A plain link (full load), so the builder's beforeunload still asks first.
      }}
      onOpenMenu={onOpenMenu}
    />
  );
}

export function HubShell({
  businessName,
  siteUrl,
  siteLabel,
  email,
  nav,
  pinned,
  orgs,
  currentOrgId,
  jumpIndex = [],
  profile,
  bell,
  alerts = null,
  banner = null,
  focused = false,
  notices = [],
  timeZone = BUSINESS_TIME_ZONE,
  suspension = null,
  impersonation = null,
  leaving = null,
  children,
}: HubShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerBody = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const mode = focused ? "focused" : contentMode(pathname, search);
  const query = search?.toString() ?? "";
  const router = useRouter();
  // 13-26: at 0 minutes the server ends the view; a refresh sends staff back to the console.
  const onImpersonationExpire = () => router.refresh();
  const showBanner =
    banner !== null &&
    !bannerSuppressed(query ? `${pathname}?${query}` : pathname);

  // DASH-29: once the drawer's dialog is open (the Drawer's own effect runs first), focus
  // the first nav link rather than the name block. Focus return is the Drawer's job.
  useEffect(() => {
    if (!menuOpen) return;
    drawerBody.current
      ?.querySelector<HTMLElement>('nav[aria-label="Hub"] a[href]')
      ?.focus();
  }, [menuOpen]);

  if (mode === "bare") return <NavGuardProvider>{children}</NavGuardProvider>;
  if (mode === "focused") {
    return (
      <NavGuardProvider>
        <FocusedFrame
          businessName={businessName}
          email={email}
          suspension={suspension}
          impersonation={impersonation}
          onExpire={onImpersonationExpire}
        >
          {children}
        </FocusedFrame>
      </NavGuardProvider>
    );
  }
  const sidebar = { businessName, siteUrl, siteLabel, nav, pinned };
  const shellOrgs: readonly ShellOrg[] =
    orgs && orgs.length > 0
      ? orgs
      : [{ id: currentOrgId ?? "", name: businessName, role: "" }];
  const current = currentOrgId ?? shellOrgs[0]?.id ?? "";
  return (
    <NavGuardProvider>
      <div className="min-h-dvh bg-hub-surface font-hub text-hub-ink">
        {impersonation ? (
          // First in DOM and tab order, before the skip link (UI-SPEC a11y line 1105).
          <ImpersonationBanner
            {...impersonation}
            endAction={endImpersonationAction}
            onExpire={onImpersonationExpire}
          />
        ) : null}
        <a
          href={`#${HUB_MAIN_ID}`}
          className={
            "sr-only rounded bg-hub-surface px-4 py-2 text-base font-semibold text-hub-accent " +
            "focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
          }
        >
          {SHELL_COPY.skipToContent}
        </a>
        <aside
          className={`fixed ${impersonation ? "top-10 bottom-0" : "inset-y-0"} left-0 hidden w-64 overflow-y-auto bg-hub-surface-2 lg:block`}
        >
          <Sidebar {...sidebar} />
        </aside>

        <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} label="Menu">
          <div ref={drawerBody} className="h-full">
            <Sidebar {...sidebar} onNavigate={() => setMenuOpen(false)} />
          </div>
        </Drawer>

        {/* 13-26: under the 40px banner the sticky top bar sits at top: 40px. */}
        <div
          className={impersonation ? "lg:pl-64 [&>header]:top-10" : "lg:pl-64"}
        >
          <ShellTopBar
            orgs={shellOrgs}
            currentOrgId={current}
            jumpIndex={jumpIndex}
            profile={profile ?? { name: email, email: "" }}
            bell={
              bell ??
              (alerts ? (
                <HubBell
                  // Review 11 WR-D01: a site switch remounts the bell, so neither the old
                  // site's count nor its loaded rows carry over.
                  key={current}
                  initialCount={alerts.count}
                  initialUrgent={alerts.urgent}
                />
              ) : null)
            }
            onOpenMenu={() => setMenuOpen(true)}
          />
          {leaving ? (
            <LeavingBanner
              days={leaving.days}
              next={leaving.next}
              hideLink={/^\/hub\/leaving\/?$/.test(pathname)}
              LinkComponent={GuardedLink}
            />
          ) : null}
          {suspension ? <SuspensionNotice {...suspension} /> : null}
          {notices.length > 0 ? (
            <ServiceNoticeStrip
              notices={notices}
              pathname={query ? `${pathname}?${query}` : pathname}
              timeZone={timeZone}
              onDismiss={(id) => dismissNoticeAction(id)}
            />
          ) : null}
          {mode === "builder" ? (
            <main id={HUB_MAIN_ID}>
              <HelpDrawerHost>{children}</HelpDrawerHost>
            </main>
          ) : (
            <main
              id={HUB_MAIN_ID}
              className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8"
            >
              {showBanner ? <div className="mb-6">{banner}</div> : null}
              <Suspense fallback={null}>
                <HubNotice />
                <HubFlash businessName={businessName} />
              </Suspense>
              <HelpDrawerHost>{children}</HelpDrawerHost>
            </main>
          )}
        </div>
      </div>
    </NavGuardProvider>
  );
}
