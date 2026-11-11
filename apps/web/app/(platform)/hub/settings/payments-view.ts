// Settings › Payments view mapping (10-25; 10-UI-SPEC "Settings › Payments"; BILL-06, PAY-03,
// PAY-10; D296). Turns the chokepoint's ConnectStatusView (10-14) into the controlled
// StripeConnectPanel view (10-19). Shared by the page (first render) and checkConnectAction
// (the re-check after Stripe sends the owner back). Pure; no account id ever reaches it beyond
// the 4-character suffix (T-10-14-02).
import type { ConnectPanelView } from "@cds/ui/hub/billing";

/** The tab, and the return / help variants of it. */
export const PAYMENTS_TAB = "/hub/settings?tab=payments";
/** "Help me set up Stripe": opens the baked how-to beside the panel (10-25 choice 2). */
export const CONNECT_HELP_HREF = "/hub/settings?tab=payments&help=stripe";
/** Standard accounts sign in to Stripe's own dashboard (the owner's account, D296). */
export const STRIPE_DASHBOARD_URL = "https://dashboard.stripe.com/";
/** UI-SPEC: the toast after a successful return from Stripe. */
export const CONNECTED_TOAST =
  "Stripe connected. Your site can take payments online.";

/** The chokepoint's status (structurally ConnectStatusView; client-safe, no @cds/db). */
export type ConnectStatusInput = {
  state: ConnectPanelView["state"];
  displayName: string | null;
  accountSuffix: string | null;
  checkedAt: string | null;
};

/** The session facts the panel needs (role and impersonation come from the session). */
export type ConnectViewer = {
  role: string;
  impersonating: boolean;
  testMode: boolean;
};

/** "just now", "2 minutes ago", "3 hours ago", "5 days ago"; null when never checked. */
export function checkedLabel(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const minutes = Math.floor(Math.max(0, now.getTime() - t) / 60_000);
  if (minutes < 1) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
}

export function connectPanelView(
  status: ConnectStatusInput,
  viewer: ConnectViewer,
  opts: { now: Date; checking?: boolean },
): ConnectPanelView {
  return {
    state: status.state,
    displayName: status.displayName,
    accountSuffix: status.accountSuffix,
    checkedLabel: checkedLabel(status.checkedAt, opts.now),
    // Only Owner and Admin reach the tab (connect:read); anything else reads as Admin.
    role: viewer.role === "owner" ? "owner" : "admin",
    impersonating: viewer.impersonating,
    testMode: viewer.testMode,
    checking: opts.checking ?? false,
    helpHref: CONNECT_HELP_HREF,
    dashboardHref:
      status.state === "connected" && !viewer.testMode
        ? STRIPE_DASHBOARD_URL
        : null,
  };
}

/** `?connect=return` (CONNECT_RETURN_PATH): the panel re-checks on mount. */
export function isConnectReturn(raw: unknown): boolean {
  const v = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  return v === "return";
}

/** `?help=stripe`: the how-to drawer opens on load (no-JS path of the help link). */
export function isConnectHelp(raw: unknown): boolean {
  const v = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  return v === "stripe";
}
