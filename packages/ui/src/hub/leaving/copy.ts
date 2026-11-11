// packages/ui/src/hub/leaving/copy.ts (14-42; 14-UI-SPEC "Leaving CDS (owner)").
// Chrome words with no UI-SPEC copy id (headings, labels, toasts, the start page's ordered
// lines). Every string with a copy id comes from P14_COPY in @cds/core/dns (14-03's file).

export const LEAVING_UI_COPY = Object.freeze({
  title: "Moving away",
  region: "Moving away",
  /** Start page, the ordered five lines (UI-SPEC "/hub/leaving before starting"). */
  lineDns:
    "First, your DNS moves back to you, so your email keeps working. Nothing else can start until it's done.",
  lineStaysUp: (endsOn: string) =>
    `Your site stays up for 30 days, until ${endsOn}.`,
  lineDownload: "Download everything: your site's data and your DNS records.",
  lineCloses: (short: string) =>
    `On ${short} your site closes. It's deleted 30 days after that.`,
  reasonLabel: "Why are you leaving? (optional)",
  reasonNone: "Choose a reason",
  noteLabel: "Anything we should know? (optional)",
  noteMax: 1000,
  codeHeading: "Confirm it's you",
  codeIntro: "To confirm, we'll email a code to the owner's address.",
  codeSent: (masked: string) => `To confirm, we emailed a code to ${masked}.`,
  sendCode: "Email me a code",
  sendingCode: "Sending…",
  resendCode: "Send a new code",
  starting: "Starting…",
  startedToast: "Your 30-day notice has started. Next: move your DNS.",
  codeMissing: "Enter the 6-digit code we emailed you.",
  /** Checklist. */
  noticeLine: (endsOn: string, days: number) =>
    `Notice ends ${endsOn} · ${days === 1 ? "1 day" : `${days} days`} left`,
  markDone: "Mark as done",
  markDoneName: (title: string) => `Mark ${title} as done`,
  downloadStarted:
    "We're building your download. We'll email you when it's ready.",
  stayToast: "Your notice is cancelled.",
  readOnly: "Only the owner can make changes here.",
  /** HandbackFlow. */
  stepA: "Download your DNS records",
  emailFirst: "Your email records are in Copy exactly. Copy them first.",
  stepB: "Where should your DNS go?",
  backToRegistrar: (registrar: string) => `Back to ${registrar}'s DNS`,
  backToRegistrarBody: (registrar: string) =>
    `Most people choose this. Turn on ${registrar}'s own DNS, then add the records from your file.`,
  anotherHost: "Another DNS host",
  anotherHostBody: "Enter the two nameservers your new DNS host gave you.",
  newNs: (n: number) => `New nameserver ${n}`,
  nsEmpty: "Paste the nameserver your new DNS host gave you.",
  nsSame: "The two nameservers need to be different.",
  stepC: "Add your records there",
  otherHostSteps:
    "At your new DNS host, add every record from your zone file. Copy the email records first.",
  checkResults: "What we found at your new DNS",
  stepD: (whose: string) => `Now change your nameservers to ${whose}`,
  whoseRegistrar: (registrar: string) => `${registrar}'s`,
  whoseOther: "your new DNS host's",
  destinationNs: "Your new nameservers",
  cdsNs: "our nameservers",
  waitingTitle: "Waiting for the change",
  doneTitle: "DNS moved back",
  missingRecords: "Records not found yet",
  rateLimited: "Wait a minute, then check again.",
  tryAgain: "That didn't go through. Check your connection and try again.",
  downloadFailed: "We couldn't make your zone file just now. Try again.",
});

/** Reason Select options (UI-SPEC; values = @cds/db OffboardingReasonCategory). */
export const LEAVE_REASONS = Object.freeze([
  { value: "provider", label: "Moving to another provider" },
  { value: "closing", label: "Closing the business" },
  { value: "cost", label: "Cost" },
  { value: "feature", label: "Missing a feature" },
  { value: "other", label: "Other" },
] as const);

export type LeaveReason = (typeof LEAVE_REASONS)[number]["value"];
