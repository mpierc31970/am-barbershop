// Copy for the email-link pages (06-UI-SPEC "Quote links" + Copywriting rows Unsubscribed,
// Address confirmed, Link expired), verbatim. Kept out of page.tsx (Next allows only its
// own exports there) and out of the "use server" actions module (async exports only).

/** Heading ids (plain strings here: exports of a "use client" module are client references). */
export const UNSUB_TITLE_ID = "unsubscribe-title";
export const CONFIRM_TITLE_ID = "confirm-email-title";

export const QUOTE_EXPIRED_TITLE = "This quote has expired";
export const QUOTE_EXPIRED_BODY =
  "Quotes last 30 days after the last change. Start a fresh one; it takes a few minutes.";

export const QUOTE_SUBMITTED_TITLE = "You've already submitted this quote";
export const QUOTE_SUBMITTED_BODY = "Sign in to keep setting up your site.";

export const UNSUB_TITLE = "Stop quote reminders?";
export const UNSUB_BODY = "We'll stop emailing you about this quote.";
export const UNSUB_DONE_TITLE = "You're unsubscribed";
export const UNSUB_DONE_BODY = "We won't send more reminders about this quote.";
export const UNSUB_OPEN_QUOTE = "Open my quote";

export const CONFIRM_TITLE = "Confirm this email address?";
export const CONFIRM_DONE_TITLE = "Address confirmed";
export const CONFIRM_BACK = "Back to your site's settings";
export const CONFIRM_SETTINGS_HREF = "/hub/settings?tab=email";

/**
 * The reminder reopen page (B-WR-01). Its GET only describes; the button POSTs, and only
 * that rotates the quote token, so a mail link scanner or a prefetch changes nothing.
 */
export const REOPEN_TITLE_ID = "quote-reopen-title";
export const REOPEN_TITLE = "Your quote is ready";
export const REOPEN_BODY =
  "Open it to pick up where you left off. Every choice you made is saved.";
export const REOPEN_BUTTON = "Open my quote";

export const LINK_EXPIRED_TITLE = "This link has expired";
export const LINK_EXPIRED_BODY =
  "Send a new confirmation from Settings › Email.";
export const LINK_EXPIRED_ACTION = "Open Settings";

/**
 * An unsubscribe link that no longer verifies (tampered, or past the quote's expiry plus
 * the 90-day grace). The UI-SPEC's Link expired body names Settings › Email, which a quote
 * visitor does not have, so the unsubscribe page keeps the title and points at the newest
 * reminder instead (06-16 decision).
 */
export const UNSUB_EXPIRED_BODY =
  "Use the unsubscribe link in your most recent reminder email.";

/** A POST that failed for a reason other than the link (network, database). */
export const LINK_ACTION_FAILED =
  "That didn't go through. Try again in a minute.";

/** "28 Oct": the day the unsubscribe page says the quote link keeps working until. */
export function linkDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

/** "Your link keeps working until 28 Oct." or "" when the quote has no future expiry. */
export function unsubscribeUntil(expiresAt: Date | null, now: Date): string {
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) return "";
  return `Your link keeps working until ${linkDate(expiresAt)}.`;
}

/**
 * What a confirmed route receives, as a sentence subject. "website inquiries" gives the
 * UI-SPEC's "Website inquiries"; the default route ("all its email") reads "Email".
 */
function routeNoun(purposeLabel: string): string {
  const noun = purposeLabel === "all its email" ? "email" : purposeLabel;
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/** Confirm state: "Rivera Bakery's website inquiries will go to ". Address follows in bold. */
export function confirmLead(orgName: string, purposeLabel: string): string {
  return `${possessive(orgName)} ${routeNoun(purposeLabel).toLowerCase()} will go to `;
}

/** Done state: "Website inquiries for Rivera Bakery will go to orders@riverabakery.com." */
export function confirmDoneBody(
  orgName: string,
  address: string,
  purposeLabel: string,
): string {
  return `${routeNoun(purposeLabel)} for ${orgName} will go to ${address}.`;
}
