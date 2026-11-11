// Site › Actions copy (13-43; 13-UI-SPEC site detail "Actions" line 791, "Open a ticket for a
// site" lines 529-536, "Suspension" lines 731-751, "Impersonation › Start" lines 808-816).
// Copy IDs (SUPER-ONLY, SUSP-NOTICE, INTERNAL-LINE, MAIL-MISTAKE-LINE) and the dialog strings
// come from P13_COPY / P13_DIALOGS (@cds/core/staff); this is the per-screen wording around
// them. `{name}` tokens are filled with fillCopy.

export const SITE_ACTIONS_COPY = Object.freeze({
  sections: {
    view: "View as CDS",
    talk: "Talk to the site",
    stage: "Stage",
    hosting: "Hosting rules",
    addons: "Add-ons",
    demo: "Demo",
  },
  rows: {
    openAdmin: {
      action: "Open as admin",
      hint: "See the hub as an Admin of this site. Ends after 60 minutes.",
    },
    openOwner: {
      action: "Open as owner",
      hint: "See the hub as the Owner, billing included. Ends after 60 minutes.",
    },
    openTicket: {
      action: "Open ticket",
      hint: "Opens a ticket on the site's behalf, shown as “Opened by CDS”.",
    },
    post: {
      action: "Post a message, note or document",
      button: "Post to site",
      hint: "Shows in the site's Support. The team gets a bell and an email.",
    },
    stage: {
      action: "Set stage",
      button: "Move stage",
      hint: "Stages only move forward. Launch with Approve launch in the pipeline.",
      current: "Now: {stage}",
      final: "This site is live. Live is final.",
      none: "No forward stage to move to. Launch with Approve launch in the pipeline.",
      label: "Move to",
    },
    notice: {
      action: "Send a notice to fix / Suspend",
      button: "Suspend or warn…",
      hint: "A notice gives 3 days to fix. Suspending takes the site offline at once.",
    },
    markFixed: {
      action: "Mark fixed",
      hint: "Ends the notice. The owner is told.",
    },
    suspendFromNotice: { button: "Suspend now…" },
    lift: {
      action: "Lift suspension",
      hint: "The site is back online at once. The owner is told.",
    },
    addons: {
      action: "Install or remove an add-on",
      button: "Go to Add-ons",
      hint: "Installing is a sale. Removing keeps the content.",
    },
  },
  hosting: {
    none: "No notice. The site is online.",
    notice: "Under notice · Fix by {when}",
    suspended: "Suspended {date} · {category}",
    noticeBadge: "Notice",
    suspendedBadge: "Suspended",
  },
  demo: {
    on: "This is the demo site. It resets every night at 3 am Central (Settings › Demo).",
    off: "Not a demo site.",
    badge: "Demo",
  },
  stages: {
    intake: "Intake",
    fit_review: "Fit review",
    ready_for_build: "Ready for build",
    being_built: "Being built",
    ready_for_review: "Ready for review",
    live: "Live",
    "": "No stage",
  } as Readonly<Record<string, string>>,
  impersonation: {
    title: "View {business} as CDS staff",
    viewLabel: "View as",
    asAdmin: "As admin",
    asOwner: "As owner",
    reason: "Reason",
    reasonHelper: "The owner sees this in their audit log.",
    note: "Ends after 60 minutes. Everything you change is logged with your name.",
    start: "Start viewing",
    safe: "Don't open",
    working: "Opening…",
  },
  openTicket: {
    title: "Open a ticket for {business}",
    site: "Site",
    type: "Type",
    types: {
      problem: "Problem",
      change: "Change",
      question: "Question",
      billing: "Billing",
    },
    subject: "Subject",
    message: "Message",
    label:
      "The ticket shows as “Opened by CDS”. It counts as answered for SLA. Owners and Admins get an alert.",
    preview: "As {business} sees it",
    openedBy: "Opened by CDS",
    primary: "Open ticket",
    safe: "Discard ticket",
    working: "Opening…",
  },
  post: {
    title: "Post to {business}",
    kind: "Kind",
    kinds: {
      message: "Message",
      internal_message: "Internal message",
      note: "Note",
      document: "Document",
    },
    body: "Message",
    noteTitle: "Title",
    noteBody: "Note",
    pin: "Pin to the top",
    docTitle: "Title",
    docNote: "Note (optional)",
    file: "File",
    fileHelper:
      "Up to 10 MB: png, jpg, webp, gif, pdf, txt, csv, docx, xlsx or pptx.",
    fileTooBig: "The file must be 10 MB or smaller.",
    preview: "As {business} sees it",
    previewEmpty: "The preview shows here once the post has its text.",
    where: {
      message: "Support › Messages",
      note: "Support › Messages, as a CDS note",
      document: "Support › Documents",
    },
    recipients: "Owners, Admins and Editors get a bell and an email.",
    internalRecipients: "Nobody is alerted.",
    primary: "Post to site",
    safe: "Don't post",
    working: "Posting…",
  },
  suspension: {
    title: "Suspend or warn {business}",
    choice: "What to do",
    notice: {
      title: "Send a notice to fix",
      description:
        "3 days to fix, then the site goes offline unless you mark it fixed.",
      category: "Category",
      whatToFix: "What to fix",
      whatHelper: "The owner sees this.",
      note: "Staff note (optional)",
      noteHelper: "Only CDS sees this.",
      fixBy: "Fix by {when}",
      preview: "As {business} sees it",
      /** The CDS note title @cds/db writes (staffSendSuspensionNotice). */
      cardTitle: "Hosting rules notice",
    },
    now: {
      title: "Suspend now",
      description:
        "For illegal content or a legal demand. The site goes offline at once.",
      reason: "Reason",
      note: "Staff note",
      noteHelper: "Required. Only CDS sees this.",
      message: "Message to the owner",
      messageDefault:
        "CDS took your site offline because of what we found on it. Reply in CDS Support and we'll sort it out together.",
      consequences: [
        "Public site answers “temporarily unavailable”",
        "The hub and CDS Support keep working",
        "Billing continues per the agreement",
      ],
    },
    categories: {
      guideline: "Hosting rules",
      dmca: "Copyright claim",
      illegal: "Illegal content",
      legal_demand: "Legal demand",
    } as Readonly<Record<string, string>>,
    working: "Working…",
  },
  markFixed: {
    title: "Mark fixed?",
    body: "The notice ends and the owner is told.",
    confirm: "Mark fixed",
    safe: "Keep the notice",
  },
});
