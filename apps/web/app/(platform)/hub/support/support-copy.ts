// CDS Support copy and pure helpers (11-42; 12-19; 12-UI-SPEC "Support frame" lines 247-270,
// "Messages" lines 274-297). Contract copy (VIEWER-READONLY, SUPPORT-EMAIL-FALLBACK, MSG-EMPTY …)
// comes from SUPPORT_UI_COPY (@cds/ui/hub/support); only screen words outside the Contract
// live here. The Care row helpers serve the Tickets tab's Your support panel (12-25).
// Browser-safe (MessagesPanel imports it).
import { CARE_PLAN_MINUTES } from "@cds/core/payments";

/** Dev default until CDS_SUPPORT_EMAIL is set (GO-LIVE), same as the hub layout. */
export const DEFAULT_SUPPORT_EMAIL = "support@connectionsdesignstudios.com";

export const BILLING_HREF = "/hub/settings?tab=billing";
/**
 * About the Care Plan: the Care Plan help article (11-46; Owner-only like this row), whose
 * Go to Settings › Billing button leads to the panel with Add the Care Plan.
 */
export const CARE_PANEL_HREF = "/hub/help/care-plan";

/** "What support includes" (12-33 writes the article; until then the help route's not-found). */
export const WHAT_SUPPORT_INCLUDES_HREF = "/hub/help/what-support-includes";

/** Get help: the new-ticket form (12-20), with the page the person came from. */
export const NEW_TICKET_HREF = "/hub/support/tickets/new";

export const SUPPORT_COPY = Object.freeze({
  title: "CDS Support",
  byline: "From the Connections Design Studios team",
  care: "Care Plan",
  careOff: "Not on your plan",
  billingLink: "Settings › Billing",
  aboutCare: "About the Care Plan",
  tabsLabel: "CDS Support sections",
  /** Messages tab (UI-SPEC lines 283-289). */
  conversationHeading: "Messages with CDS",
  composerLabel: "Write to CDS",
  composerFooter:
    "CDS usually replies within 2 business days. For something broken on your site, Get help opens a ticket we track.",
  /** Polling (UI-SPEC lines 294-297). */
  newMessages: (n: number) =>
    n === 1 ? "1 new message from CDS" : `${n} new messages from CDS`,
  newMessagesButton: (n: number) =>
    n === 1 ? "1 new message" : `${n} new messages`,
  /** Tickets tab (12-25; UI-SPEC lines 355-372). */
  ticketsHeading: "Your tickets",
  ticketsShowLabel: "Show tickets",
  ticketsShow: Object.freeze({ open: "Open", closed: "Closed", all: "All" }),
  /** TICKETS-EMPTY body for read-only roles (no Get help link). */
  ticketsEmptyReadOnly: "Tickets your team sends to CDS will appear here.",
  yourSupport: "Your support",
  supportRow: "Support",
  supportIncluded: "Included in your plan",
  /** Documents tab (12-25): past the first loaded page. */
  showOlderDocs: "Show older documents",
  showOlderFiles: "Show older files",
  /** Ideas tab (12-25; UI-SPEC lines 525-545). */
  ideasSearch: "Search ideas",
  ideasStatusLabel: "Idea status",
});

/** "On · 25 of 60 minutes used in October". */
export function careOnLine(used: number, monthLabel: string): string {
  return `On · ${used} of ${CARE_PLAN_MINUTES} minutes used in ${monthLabel}`;
}

/** mailto: with "Help with {Business}" as the subject and the site id in the body footer. */
export function supportMailto(
  address: string,
  business: string,
  orgId: string,
): string {
  const subject = `Help with ${business}`;
  const body = `\n\n\n--\nSite: ${business} (${orgId})`;
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** The Get help href, carrying where the person was (`from`, a hub path only). */
export function getHelpHref(from: string): string {
  const safe =
    from.startsWith("/hub/") && !from.startsWith("//") ? from : "/hub/support";
  return `${NEW_TICKET_HREF}?from=${encodeURIComponent(safe)}`;
}
