// Paid-service and incident words (12-10 choice 6; 12-UI-SPEC lines 459-499). PAID-RULE and
// PAID-ASK-OWNER come from SUPPORT_UI_COPY (core anchors); these are the panel's other lines.
export const PAID_COPY = Object.freeze({
  heading: "This is a paid service",
  diyTitle: "Do it yourself",
  diyLine: "Most changes like this take a few minutes in your dashboard.",
  cdsTitle: "Have CDS do it",
  cdsLine: "We'll send you a price first. Nothing starts until you accept.",
  requested: (day: string) => `Quote requested ${day}. CDS will send it here.`,
  sent: (day: string, amount: string) =>
    amount ? `Sent ${day} · ${amount}` : `Sent ${day}`,
  accepted: (day: string) =>
    `You accepted the quote on ${day}. CDS has started.`,
  careTitle: "Use my Care hour",
  careLeft: (left: number, total: number, month: string) =>
    `You have ${left} of ${total} minutes left in ${month}.`,
  careNone: (month: string) => `No Care minutes left in ${month}.`,
  careChosen: (day: string) =>
    `You chose your Care hour on ${day}. CDS has started.`,
  careUpsell:
    "With the Care Plan, small jobs like this use your monthly Care hour.",
  aboutCare: "About the Care Plan",
  dialogTitle: "Use your Care hour on this?",
  dialogBody: (left: number, month: string) =>
    `CDS works on it using this month's Care Plan time and tells you how many minutes it took. You have ${left} minutes left in ${month}.`,
  saving: "Saving…",
  incidentHeading: (title: string) => `Known problem: ${title}`,
  incidentOpen: "Being fixed",
  incidentFixed: "Fixed",
  incidentUpdated: (time: string) => `Updated ${time}`,
  incidentFixedLine: (when: string) =>
    when
      ? `Fixed ${when}. Your ticket was marked resolved.`
      : "Fixed. Your ticket was marked resolved.",
  /**
   * The notice strip's What happened dialog (12-REVIEW WR-D08): the person may have no ticket,
   * so no ticket sentence. Empty without a time (the Fixed badge already says it).
   */
  incidentFixedNoticeLine: (when: string) => (when ? `Fixed ${when}.` : ""),
});

/** About the Care Plan: the Care Plan help article (11-46). */
export const CARE_PLAN_HELP_HREF = "/hub/help/care-plan";

/** P10 QuotePanel route for a sent work order. */
export function quoteHrefFor(workOrderId: string): string {
  return `/hub/settings/quotes/${encodeURIComponent(workOrderId)}`;
}
