// P13 copy (P13-P16; 13-UI-SPEC "Copywriting Contract"). The one copy source for the staff
// console, the hub notices, the suspended page and P13 mail. Pure and browser-safe. Keys are
// the UI-SPEC copy IDs with "-" written as "_". Strings are verbatim; `{name}` tokens stay
// literal and are filled with `fillCopy`. Where the UI-SPEC shows an example value in a
// dialog ("I-3", "4 linked tickets", "{52} min"), the value is a named token here.
// Never retype this copy in a component (EXECUTOR-BRIEF).

export const P13_COPY = {
  TODAY_EMPTY_H: "Nothing needs you.",
  TODAY_EMPTY_B: "Go do something nice.",
  INBOX_EMPTY_H: "No open tickets.",
  INBOX_EMPTY_B: "New tickets from sites land here.",
  PREMIUM_EMPTY_H: "No premium add-ons are installed yet.",
  PREMIUM_EMPTY_B:
    "Booking arrives in v1.1. Health checks, alerts and the fail-safe are ready for it.",
  INTERNAL_LINE: "Only CDS sees this.",
  BANNER:
    "Viewing {business} as CDS staff · as {admin} · {reason} · {minutes} min left",
  BANNER_END: "End",
  RATING_Q: "Was this resolved well?",
  RATING_YES: "Yes",
  RATING_NO: "No",
  HELD_TENANT: "This page is being reviewed, usually within 2 business days.",
  SUSPENDED_PAGE_TITLE: "Temporarily unavailable",
  SUSPENDED_PAGE_H: "This site is temporarily unavailable.",
  SUSPENDED_PAGE_B: "Please check back later.",
  SUSP_NOTICE:
    "CDS found something on your site that breaks the hosting rules. Fix it by {when} or your site goes offline.",
  SUSP_OFFLINE:
    "Your site is offline. CDS suspended it on {date}. Your hub and CDS Support still work.",
  STAFF_SIGNIN_FAILED: "That email and password don't match a staff account.",
  CODE_WRONG: "That code isn't right. Check the latest email.",
  CODE_EXPIRED: "That code has expired. Send a new one.",
  RATE_SIGNIN: "Too many tries. Wait 15 minutes, then try again.",
  SESSION_ENDED: "Your staff session ended. Sign in again to continue.",
  REFUSED_ROLE: "Your role can't do this. Ask a Super Admin.",
  SUPER_ONLY: "Super Admin only",
  PLACEHOLDER_HELP: "Placeholders fill in when you insert the reply.",
  PLACEHOLDER_UNKNOWN:
    "{token} isn't a placeholder. Use {first_name}, {business}, {ticket} or {agent}.",
  WINDOW_RANGE: "The end must be after the start, and within 7 days.",
  RATE_REPORT:
    "Too many reports from this connection. Try again in an hour, or email abuse@connectionsdesignstudios.com.",
  ERR_SEND:
    "That didn't send. Check your connection and try again. Your text is kept.",
  LAUNCH_ANYWAY: "Launch anyway",
  UNDO_ARCHIVED: "Archived “{title}”.",
  UNDO: "Undo",
  // P13 mail lines (UI-SPEC "Emails"); the templates in @cds/db read these.
  MAIL_NO_COMMENT: "No comment",
  MAIL_MISTAKE_LINE: "If you think this is a mistake, reply in CDS Support.",
  MAIL_HUB_WORKS: "Your hub and CDS Support still work.",
  MAIL_BACK_ONLINE: "Your site is back online. Thanks for sorting it out.",
  MAIL_REPORT_REVIEW:
    "CDS reviews every report, usually within 2 business days.",
} as const;

export type P13CopyId = keyof typeof P13_COPY;

/** One destructive or irreversible dialog (UI-SPEC lines 1066-1088). */
export interface P13Dialog {
  readonly title: string;
  readonly body: string;
  readonly confirm: string;
  readonly safe: string;
}

export const P13_DIALOGS = {
  approve_launch: {
    title: "Make {business} live?",
    body: "Live is final. The stage can't move back.",
    confirm: "Make it live",
    safe: "Not yet",
  },
  approve_fit: {
    title: "Approve {business}?",
    body: "The owner is emailed and can continue to checkout.",
    confirm: "Approve fit",
    safe: "Keep holding",
  },
  decline_fit: {
    title: "Decline {business}?",
    body: "Full refund of {amount}. The site closes.",
    confirm: "Decline and refund",
    safe: "Keep holding",
  },
  stage_forward: {
    title: "Move {business} to {stage}?",
    body: "Stages only move forward.",
    confirm: "Move stage",
    safe: "Not yet",
  },
  suspend_now: {
    title: "Suspend {business} now?",
    body: "The public site goes offline at once.",
    confirm: "Suspend now",
    safe: "Don't suspend",
  },
  suspend_notice: {
    title: "Send a notice to {business}?",
    body: "3 days to fix, then the site goes offline.",
    confirm: "Send notice",
    safe: "Don't send",
  },
  suspend_lift: {
    title: "Lift the suspension?",
    body: "The site is back online at once.",
    confirm: "Lift suspension",
    safe: "Keep suspended",
  },
  media_takedown: {
    title: "Take down {file}?",
    body: "The file is deleted and removed from the CDN. Pages using it: {pages}.",
    confirm: "Take down file",
    safe: "Keep the file",
  },
  unpublish_page: {
    title: "Unpublish {page}?",
    body: "Visitors stop seeing it; the owner is told.",
    confirm: "Unpublish page",
    safe: "Keep it published",
  },
  addon_install: {
    title: "Install {addon} on {business}?",
    body: "It is a sale: {price} is added from the next invoice.",
    confirm: "Install",
    safe: "Keep as is",
  },
  addon_uninstall: {
    title: "Uninstall {addon}?",
    body: "Its content is kept and comes back if reinstalled.",
    confirm: "Uninstall",
    safe: "Keep as is",
  },
  price_save: {
    title: "Change {key} {path}?",
    body: "{old} → {new}",
    confirm: "Save price",
    safe: "Keep price",
  },
  window_end: {
    title: "End {code} now?",
    body: "Editing reopens for {target}.",
    confirm: "End now",
    safe: "Keep it",
  },
  incident_resolve: {
    title: "Resolve {code}?",
    body: "{count} linked tickets will move to Resolved.",
    confirm: "Resolve incident",
    safe: "Keep open",
  },
  bulk_status: {
    title: "Set {count} tickets to {status}?",
    body: "Owners of {sites} sites get an alert.",
    confirm: "Set status",
    safe: "Keep as is",
  },
  ideas_merge: {
    title: "Merge “{from}” into “{into}”?",
    body: "Votes {a} + {b} → {total} ({both} sites voted for both).",
    confirm: "Merge ideas",
    safe: "Keep separate",
  },
  idea_built: {
    title: "Mark “{idea}” Built?",
    body: "{count} sites that voted get an alert.",
    confirm: "Mark built",
    safe: "Not yet",
  },
  demo_reset: {
    title: "Reset {business} now?",
    body: "No other site changes.",
    confirm: "Reset now",
    safe: "Don't reset",
  },
  resubmit_all: {
    title: "Resubmit {count} live sites?",
    body: "",
    confirm: "Resubmit all",
    safe: "Not now",
  },
  staff_role: {
    title: "Make {name} a {role}?",
    body: "Takes effect on their next click.",
    confirm: "Change role",
    safe: "Keep role",
  },
} as const satisfies Record<string, P13Dialog>;

export type P13DialogId = keyof typeof P13_DIALOGS;

/**
 * Fill `{token}` placeholders from `vars`. Tokens without a value are left untouched, so a
 * missing variable shows up as "{token}" rather than vanishing.
 */
export function fillCopy(
  text: string,
  vars: Readonly<Record<string, string | number>>,
): string {
  return text.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : whole,
  );
}
