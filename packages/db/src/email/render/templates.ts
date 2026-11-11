// The P6 email templates (EMAIL-01, UI-SPEC "Emails"; PD-23 adds fit.approved/fit.declined;
// P7 07-01 adds form.submission (owner words: "message") and the staff media.alert;
// P8 08-10 adds the staff site.assembled / site.assembly_failed hand-off emails;
// P9 09-13 adds agreement.signed, the signer's record and download link;
// P11 11-10 adds alert.notify, alerts.digest, reports.monthly, data_export.ready, member.invite;
// P12 12-05 adds the no-reply CDS Support mail: support.notify and the staff support.sla_risk;
// P13 13-02 adds the staff health/rating/budget mail, suspension mail and report mail;
// P14 14-03 adds the domain, launch review and Leaving CDS mail and staff.domain_alert).
// Copy is UI-SPEC verbatim. Every substitution into HTML goes through escapeHtml, and every
// subject through headerValue (T-06-25, RESEARCH Pitfall 11).
import { escapeHtml, headerValue } from "@cds/core/email";
import { formatCents } from "@cds/core/pricing";
import {
  replySubject,
  statusSubject,
  SUPPORT_COPY,
  type TicketStatus,
} from "@cds/core/support";
import { fillCopy, P13_COPY } from "@cds/core/staff";
import {
  GATE_RULE_NAMES,
  P14_COPY,
  STAFF_ALERT_KIND_WORDS,
  STAFF_STEP_WORDS,
  type GateRuleId,
  type MoveStepKey,
  type StaffDomainAlertKind,
} from "@cds/core/dns";
import { layout, paragraph, safeHref, textLink } from "./layout";

/** The alert kinds one `support.notify` email can stand for (UI-SPEC lines 670-677). */
export type SupportEmailKind =
  | "support.reply"
  | "support.status"
  | "cds.message"
  | "cds.note"
  | "cds.document"
  | "cds.notice"
  | "cds.idea_built";

/** `support.notify` data. Links are absolute hub URLs built by the caller. */
export type SupportEmailVars = {
  kind: SupportEmailKind;
  /** Business name (preheader for non-ticket kinds, so a person in two sites knows which). */
  business: string;
  /** Required for support.reply / support.status (status required for support.status). */
  ticket?: { number: number; subject: string; status?: TicketStatus };
  /** Note or document title; for cds.notice the full subject line. */
  title?: string;
  /** First name of the CDS person ("Mara"); omitted means "CDS". */
  authorFirstName?: string;
  /**
   * P13 (13-02; STAFF-21): signed rating links. Used only for support.status Resolved, as
   * RATING-Q with two plain text links Yes / No (never buttons; one-button rule kept).
   */
  ratingLinks?: { up: string; down: string };
  /** Message, note or notice text; only the first 300 characters are sent (T-12-05-03). */
  excerpt?: string;
  href: string;
};

export type EmailData = {
  "quote.saved": {
    pathLabel: string;
    addonCount: number;
    buildCents: number;
    monthlyCents: number;
    dueCents: number;
    expiresAt: Date;
    link: string;
  };
  "quote.reminder": {
    day: 1 | 3;
    pathLabel: string;
    expiresAt: Date;
    link: string;
    /** GET landing page (confirm screen) for the footer link. */
    unsubscribeLink: string;
    /** RFC 8058 one-click POST target for the List-Unsubscribe header. */
    unsubscribePostUrl: string;
  };
  "email.confirm": { orgName: string; purposeLabel: string; link: string };
  "fit.approved": { orgName: string; link: string };
  "fit.declined": { orgName: string };
  "form.submission": {
    siteName: string;
    formName: string;
    pageTitle: string | null;
    answers: { label: string; value: string }[];
    newsletter: boolean | null;
    replyable: boolean;
    inboxLink: string;
    submittedAt: Date;
  };
  // P10 (10-36): the owner's Forms Pro auto-reply ({name} already filled); no button.
  "form.auto_reply": { orgName: string; subject: string; body: string };
  // P10 (10-37): Forms Pro "save and finish later"; `expires` pre-formatted ("9 Nov 2026").
  "form.resume_link": {
    orgName: string;
    formName: string;
    link: string;
    expires: string;
  };
  "media.alert": {
    event: "cdn-fallback-start" | "cdn-fallback-cap" | "over-allowance";
    at: Date;
    orgName: string | null;
    detail: string;
    link: string | null;
  };
  // P8 (08-10): structured data only; the template renders it (choice 1). No PII.
  "site.assembled": {
    businessName: string;
    pathLabel: string;
    businessTypeLabel: string;
    templateId: string;
    templateVersion: number;
    assembledAt: Date;
    orgId: string;
    pages: { label: string; url: string }[];
    polish: string[];
    filled: string[];
    leftOut: string[];
  };
  "site.assembly_failed": {
    businessName: string;
    errorCode: string;
    page: string;
    finishedPages: string[];
    lastTry: Date;
    orgId: string;
    attempts: number;
  };
  // P9 (09-13): dates are pre-formatted in UTC like the signed copy ("8 Oct 2026", "7:14 pm UTC").
  "agreement.signed": {
    firstName: string;
    orgName: string;
    signedDate: string;
    signedTime: string;
    /** One line per policy: "Service Agreement, version 1". */
    policies: readonly string[];
    /** The session-checked hub download route, never a bearer link (D-UI-P9-11). */
    link: string;
    proofCode: string;
  };
  // P10 (10-03): amounts are cents and dates are pre-formatted ("8 Oct 2026") by the caller;
  // templates never compute money. No card numbers, no customer emails (T-10-03-03).
  "billing.receipt": {
    firstName: string;
    orgName: string;
    /** "8 Oct 2026": the day the payment was taken. */
    paidOn: string;
    paidCents: number;
    taxCents: number;
    lines: readonly { label: string; cents: number }[];
    nextBill: { date: string; cents: number } | null;
    invoiceUrl: string;
  };
  "billing.card_failed": {
    orgName: string;
    amountCents: number;
    date: string;
    updateUrl: string;
  };
  "billing.lapsed": {
    orgName: string;
    amountCents: number;
    addons: readonly string[];
    payUrl: string;
  };
  "billing.restored": { addons: readonly string[]; hubUrl: string };
  "billing.quote_sent": {
    title: string;
    scopeLine: string;
    totalCents: number;
    depositCents: number | null;
    validUntil: string;
    quoteUrl: string;
  };
  "billing.stripe_setup": { orgName: string; setupUrl: string };
  "org.declined": {
    refundedCents: number;
    reason: "fit" | "capacity" | "scope" | "other";
    otherNote: string | null;
    deleteOn: string;
    agreementUrl: string;
  };
  "billing.staff_alert": {
    event:
      | "stripe_restricted"
      | "stripe_disconnected"
      | "unpriced_item"
      | "payments_unavailable"
      | "webhook_failed"
      | "reconcile_failed"
      | "quote_declined"
      | "duplicate_checkout"
      | "stray_checkout"
      | "provider_id_conflict";
    orgName: string;
    orgId: string;
    detail: string;
  };
  // P11 (11-10). Links are absolute hub URLs built (and isHubHref-checked) by the caller.
  "alert.notify": {
    business: string;
    /** Owner-word section name, e.g. "Inbox", "Billing". */
    section: string;
    title: string;
    /** The no-names title for sensitive-practice mode ("New booking for Thursday"). */
    safeTitle: string;
    sensitive: boolean;
    /** The item's action: Reply, Fix your card, View booking. */
    actionLabel: string;
    href: string;
    sentAt: Date;
    /** Owner words for the alert kind in the footer ("new message"). */
    alertLabel: string;
    /** Absolute link to /hub/profile#alerts. */
    settingsHref: string;
    /** IANA zone for "Sent {time}"; defaults to America/Chicago. */
    timeZone?: string;
  };
  "alerts.digest": {
    business: string;
    /** Grouped lines; safeText is required when sensitive (never names clients). */
    lines: readonly { text: string; safeText?: string; count?: number }[];
    sensitive?: boolean;
    href: string;
    settingsHref: string;
  };
  "reports.monthly": {
    business: string;
    /** "October". */
    month: string;
    visitors: number;
    messages: number;
    /** Exactly five: Visitors, Top page, Top source, Messages, Speed or SEO change. */
    lines: readonly string[];
    tip: string;
    href: string;
  };
  "data_export.ready": { business: string; href: string; expiresOn: string };
  /** Studio Booking: a booking confirmation, reminder or cancellation to the client. */
  "booking.notice": {
    subject: string;
    lead: string;
    facts: [string, string][];
    why: string;
    button?: { label: string; href: string };
  };
  "support.notify": SupportEmailVars;
  "support.sla_risk": {
    ticketNumber: number;
    business: string;
    /** "Something isn't working". */
    typeLabel: string;
    /** "1 day 20 hours". */
    age: string;
    /** "3:00 pm today". */
    due: string;
  };
  "member.invite": {
    business: string;
    inviterName: string;
    /** "Editor", "Admin", "Viewer". */
    role: string;
    href: string;
    expiresOn: string;
  };
  // P13 (13-02; P13-P17, UI-SPEC Emails lines 990-1001).
  "staff.health_alert": HealthAlertData;
  "support.rating_down": RatingDownData;
  "scan.budget_cap": BudgetCapData;
  "site.suspension_notice": SuspensionNoticeData;
  "site.suspended": SuspendedData;
  "site.suspension_lifted": SuspensionLiftedData;
  "report.content_notice": ReportContentNoticeData;
  "report.received": ReportReceivedData;
  // P14 (14-03; 14-UI-SPEC "Emails").
  "domain.records_copied": DomainStepData;
  "domain.nameserver_steps": NameserverStepsData;
  "domain.connected": { domain: string; href: string };
  "domain.switch_back": DomainStepData & { count: number };
  "domain.lost_delegation": DomainStepData;
  "domain.expiry": DomainStepData & { days: 30 | 7; expiresOn: Date };
  "review.sent": Record<string, never>;
  "offboarding.started": { endsOn: Date; href: string };
  "offboarding.handed_back": Record<string, never>;
  "offboarding.handback_overdue": { href: string };
  "staff.domain_alert": StaffDomainAlertData;
  // P15 (15-03; HUB-07, P15-P14): staff copy of a hub /contact message.
  "hub.inquiry": HubInquiryData;
};

/**
 * `hub.inquiry` (15-03): sent as CDS to staffAlertAddress() only, never to the visitor; the
 * visitor's address is the Reply-To. Every value is the visitor's own text, escaped here.
 */
export type HubInquiryData = {
  name: string;
  email: string;
  business: string;
  /** "Question", "Book a call", "Press". */
  topicLabel: string;
  phone: string;
  about: string;
  message: string;
};

// ---- P14 data shapes (14-03). Domains are written in full; dates are formatted here. ----

/** Owner domain mail: the domain, its registrar's name and the hub link. */
export type DomainStepData = {
  domain: string;
  /** "GoDaddy". */
  registrar: string;
  /** Hub Settings › Domain URL. */
  href: string;
};

/**
 * Sent to an address the owner typed (not a member, T-14-03-03): no hub link, no
 * credentials, no button; the owner's note is capped at 500 characters.
 */
export type NameserverStepsData = {
  /** The owner's first name ("Maria"). */
  sender: string;
  business: string;
  domain: string;
  registrar: string;
  /** Exactly the two assigned nameservers. */
  nameservers: readonly [string, string];
  /** Registrar steps, one plain line each (14-05 registrar data). */
  steps: readonly string[];
  note?: string;
};

/** Staff: ids, counts and the kind only; never record values or owner contact (T-14-03-02). */
export type StaffDomainAlertData = {
  kind: StaffDomainAlertKind;
  business: string;
  orgId: string;
  domain: string;
  /** "M-14". */
  moveCode?: string;
  step?: MoveStepKey;
  rule?: GateRuleId;
  /** Records affected. */
  count?: number;
  /** Console Site › Domain URL. */
  href: string;
};

// ---- P13 data shapes (13-02). 13-16/17/23/30/44 send these unchanged. ----

/** Staff: one email when a health check opens or closes an incident (P13-P19). */
export type HealthAlertData = {
  /** "open" when a check crosses warning/critical; "close" when it passes again. */
  state: "open" | "close";
  level: "warning" | "critical";
  /** "PocketBase latency". */
  component: string;
  /** "2.4 s". */
  reading: string;
  /** "Warning above 1 s, critical above 2 s". */
  threshold: string;
  /** When the incident opened. */
  since: Date;
  /** Console Health URL. */
  href: string;
};

/** Staff: a thumbs-down rating on a resolved ticket (STAFF-21, P13-P18). */
export type RatingDownData = {
  ticketNumber: number;
  business: string;
  /** Rated agent's display name ("Mara"); empty means unassigned. */
  agent: string;
  subject: string;
  /** The owner's comment, or null for none (shows "No comment"). */
  comment: string | null;
  resolvedAt: Date;
  /** Console ticket URL. */
  href: string;
};

/** Staff: the Web Risk monthly cap was reached (D295, P13-P27). No button. */
export type BudgetCapData = {
  /** "2026-10". */
  month: string;
  cap: number;
  used: number;
};

/** Owner and Admins: a notice to fix before suspension (STAFF-22). */
export type SuspensionNoticeData = {
  business: string;
  /** The fix-by deadline; shown as "Thu 16 Oct" in America/Chicago. */
  fixBy: Date;
  /** Staff text: what to fix. */
  whatToFix: string;
  /** Hub URL that shows the notice. */
  href: string;
};

/** Owner and Admins: the site is suspended (STAFF-22). */
export type SuspendedData = {
  business: string;
  suspendedAt: Date;
  /** Reason category label ("Hosting rules"). */
  reasonLabel: string;
  /** Hub CDS Support URL. */
  href: string;
};

/** Owner and Admins: the suspension was lifted. */
export type SuspensionLiftedData = { business: string; href: string };

/**
 * Owner and Admins: someone reported a page (STAFF-24, D249). URL and category only; the
 * reporter's name and email are never part of this shape (T-13-02-02).
 */
export type ReportContentNoticeData = {
  business: string;
  /** The reported page URL, shown as text (never a link). */
  url: string;
  categoryLabel: string;
  /** Hub URL. */
  href: string;
};

/**
 * The reporter: we received your report (STAFF-24). No owner contact is ever part of this
 * shape, no outcome promise, no button (T-13-02-02).
 */
export type ReportReceivedData = {
  /** "R-32". */
  caseCode: string;
  url: string;
  categoryLabel: string;
  // No `details`: the reporter's own text is never echoed back (review WR-A04), so the
  // anonymous form cannot relay arbitrary words to any inbox from CDS.
};

export type RenderedParts = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

export type RenderOptions = { brand?: string };

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "28 Oct" (UTC). */
export function shortDate(d: Date): string {
  return SHORT_DATE.format(d);
}

const CT_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "America/Chicago",
});
const CT_TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Chicago",
});

/** "7 Oct, 2:14 pm CT" (staff are in Texas; 08-10 choice 3). */
export function staffDateTime(d: Date): string {
  return `${CT_DAY.format(d)}, ${CT_TIME.format(d)} CT`;
}

/** "$39 a month" in sentences (UI-SPEC Voice). */
function aMonth(cents: number): string {
  return `${formatCents(cents)} a month`;
}

function addonPhrase(n: number): string {
  const k = Math.max(0, Math.floor(n));
  if (k === 0) return "no add-ons";
  return k === 1 ? "1 add-on" : `${k} add-ons`;
}

const QUOTE_WHY =
  "You're getting this because you saved a quote at connectionsdesignstudios.com.";

function quoteSaved(
  d: EmailData["quote.saved"],
  o: RenderOptions,
): RenderedParts {
  const path = d.pathLabel;
  const until = shortDate(d.expiresAt);
  const intro = `Here's the quote you saved: a ${path} website with ${addonPhrase(d.addonCount)}.`;
  const rows: [string, string][] = [
    ["Build", formatCents(d.buildCents)],
    ["Monthly", `${formatCents(d.monthlyCents)}/mo`],
    ["Due at checkout", formatCents(d.dueCents)],
  ];
  const table =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1B1B19;font-variant-numeric:tabular-nums">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 0">${escapeHtml(k)}</td><td align="right" style="padding:4px 0;font-weight:600">${escapeHtml(v)}</td></tr>`,
      )
      .join("") +
    `</table>`;
  const untilLine = `Your link works until ${until}.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader: `${path} website: ${formatCents(d.buildCents)} build, then ${aMonth(d.monthlyCents)}.`,
    bodyHtml:
      paragraph(escapeHtml(intro)) + table + paragraph(escapeHtml(untilLine)),
    bodyText: [
      intro,
      "",
      ...rows.map(([k, v]) => `${k}: ${v}`),
      "",
      untilLine,
    ].join("\n"),
    button: { label: "Open my quote", href: d.link },
    footerHtml: paragraph(escapeHtml(QUOTE_WHY), true),
    footerText: QUOTE_WHY,
  });
  return {
    subject: headerValue("Your website quote"),
    preheader: `${path} website: ${formatCents(d.buildCents)} build, then ${aMonth(d.monthlyCents)}.`,
    html,
    text,
  };
}

function quoteReminder(
  d: EmailData["quote.reminder"],
  o: RenderOptions,
): RenderedParts {
  const until = shortDate(d.expiresAt);
  const day3 = d.day === 3;
  const subject = day3
    ? "Still thinking about your website?"
    : "Your website quote is saved";
  const preheader = day3
    ? `Your quote is saved until ${until}.`
    : "Pick up right where you left off.";
  const body = day3
    ? [
        `Your ${d.pathLabel} website quote is saved until ${until}. Submitting it is free: you tell us about your business first, and nothing is charged until checkout.`,
      ]
    : [
        `You started a quote for a ${d.pathLabel} website yesterday. It's saved just as you left it, add-ons and all.`,
        "Questions? Reply to this email and a person will answer.",
      ];
  const lastLine = day3 ? "This is the last reminder." : "";
  const footerHtml =
    paragraph(escapeHtml(QUOTE_WHY), true) +
    paragraph(
      `${escapeHtml("Don't want reminders?")} ${textLink("Unsubscribe", d.unsubscribeLink)}.` +
        (lastLine ? ` ${escapeHtml(lastLine)}` : ""),
      true,
    );
  const footerText = [
    QUOTE_WHY,
    "Don't want reminders? Unsubscribe:",
    d.unsubscribeLink,
    ...(lastLine ? [lastLine] : []),
  ].join("\n");
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: body.map((p) => paragraph(escapeHtml(p))).join(""),
    bodyText: body.join("\n\n"),
    button: {
      label: day3 ? "Open my quote" : "Pick up where I left off",
      href: d.link,
    },
    footerHtml,
    footerText,
  });
  return { subject: headerValue(subject), preheader, html, text };
}

function emailConfirm(
  d: EmailData["email.confirm"],
  o: RenderOptions,
): RenderedParts {
  const lead = `${d.orgName}'s website will send `;
  const tail = " to this address. Confirm it's right:";
  const after =
    "If you didn't expect this, ignore it. Nothing is sent here until it's confirmed.";
  const why = `You're getting this because someone added this address to ${d.orgName}'s website.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader: "One click and you're set.",
    bodyHtml: paragraph(
      `${escapeHtml(lead)}<strong>${escapeHtml(d.purposeLabel)}</strong>${escapeHtml(tail)}`,
    ),
    bodyText: `${lead}${d.purposeLabel}${tail}`,
    button: { label: "Confirm this address", href: d.link },
    afterHtml: paragraph(escapeHtml(after), true),
    afterText: after,
    footerHtml:
      paragraph(escapeHtml(why), true) +
      paragraph(escapeHtml("The link works for 7 days."), true),
    footerText: `${why}\nThe link works for 7 days.`,
  });
  return {
    subject: headerValue(`Confirm your email for ${d.orgName}`),
    preheader: "One click and you're set.",
    html,
    text,
  };
}

function fitApproved(
  d: EmailData["fit.approved"],
  o: RenderOptions,
): RenderedParts {
  const body =
    "Thanks for waiting. Your site is cleared, and you can keep setting it up.";
  const why = `You're getting this because you're setting up ${d.orgName}'s website with CDS.`;
  const preheader = "You can keep setting up your site.";
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: paragraph(escapeHtml(body)),
    bodyText: body,
    button: { label: "Continue setup", href: d.link },
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return {
    subject: headerValue("Your site is cleared"),
    preheader,
    html,
    text,
  };
}

function fitDeclined(
  d: EmailData["fit.declined"],
  o: RenderOptions,
): RenderedParts {
  const body =
    "We've looked at your answers and can't host this site. Reply to this email if you think we got it wrong.";
  const why = `You're getting this because you started a website for ${d.orgName} with CDS.`;
  const preheader = "An update on your website.";
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: paragraph(escapeHtml(body)),
    bodyText: body,
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return {
    subject: headerValue("About your website with CDS"),
    preheader,
    html,
    text,
  };
}

/** Escape, then keep the visitor's line breaks. */
function multiline(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");
}

function formSubmission(
  d: EmailData["form.submission"],
  o: RenderOptions,
): RenderedParts {
  const on = d.pageTitle ? ` on ${d.pageTitle}` : "";
  const preheader = `${d.formName} form${on}`;
  const intro = `Someone sent a message through your ${d.formName} form${on}.`;
  const rows = d.answers
    .map(
      (a) =>
        `<tr><td style="padding:8px 0 0;font-weight:600">${escapeHtml(a.label)}</td></tr>` +
        `<tr><td style="padding:0 0 8px">${multiline(a.value)}</td></tr>`,
    )
    .join("");
  const table =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1B1B19">` +
    rows +
    `</table>`;
  const newsletterLine = d.newsletter === true ? "Newsletter: Agreed" : "";
  const reply = "Reply to this email to answer them.";
  const why = `You're getting this because ${d.siteName}'s website sends form messages to this address.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml:
      paragraph(escapeHtml(intro)) +
      table +
      (newsletterLine ? paragraph(escapeHtml(newsletterLine)) : ""),
    bodyText: [
      intro,
      "",
      ...d.answers.map((a) => `${a.label}: ${a.value}`),
      ...(newsletterLine ? ["", newsletterLine] : []),
    ].join("\n"),
    button: { label: "Open Inbox", href: d.inboxLink },
    ...(d.replyable
      ? { afterHtml: paragraph(escapeHtml(reply), true), afterText: reply }
      : {}),
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return {
    subject: headerValue(`New message from your website: ${d.formName}`),
    preheader,
    html,
    text,
  };
}

/** Forms Pro auto-reply (BILL-14, D233; 10-36): owner subject header-safe, body escaped. */
function formAutoReply(
  d: EmailData["form.auto_reply"],
  o: RenderOptions,
): RenderedParts {
  const body = d.body.replace(/\r\n|\r/g, "\n");
  const preheader = (body.split("\n").find((l) => l.trim() !== "") ?? "")
    .trim()
    .slice(0, 120);
  const why = `You're getting this because you sent a form on ${d.orgName}'s website.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: paragraph(multiline(body)),
    bodyText: body,
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return { subject: headerValue(d.subject), preheader, html, text };
}

/** Forms Pro save-and-finish-later link (BILL-14, D233; 10-37): button "Finish your form". */
function formResumeLink(
  d: EmailData["form.resume_link"],
  o: RenderOptions,
): RenderedParts {
  const intro = `You saved your ${d.formName} form on ${d.orgName}'s website. Your answers are kept so you can finish it later.`;
  const until = `The link works until ${d.expires}. After that your saved answers are deleted.`;
  const why = `You're getting this because you asked to save a form on ${d.orgName}'s website. If that wasn't you, ignore this email.`;
  const preheader = `Pick up your ${d.formName} form where you left off.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: paragraph(escapeHtml(intro)) + paragraph(escapeHtml(until)),
    bodyText: [intro, "", until].join("\n"),
    button: { label: "Finish your form", href: d.link },
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return {
    subject: headerValue(`Finish your ${d.formName} form`),
    preheader,
    html,
    text,
  };
}

const MEDIA_ALERT_SUBJECTS: Record<
  EmailData["media.alert"]["event"],
  (orgName: string) => string
> = {
  "cdn-fallback-start": () => "Media CDN is down: serving media from the app",
  "cdn-fallback-cap": () => "Media CDN down 72 hours: videos paused",
  "over-allowance": (org) => `${org} is over its 2 GB media allowance`,
};

function mediaAlert(
  d: EmailData["media.alert"],
  o: RenderOptions,
): RenderedParts {
  const subject = MEDIA_ALERT_SUBJECTS[d.event](d.orgName ?? "A tenant");
  const since = `Since ${shortDate(d.at)}`;
  const why = "CDS staff alert.";
  const { html, text } = layout({
    brand: o.brand,
    preheader: subject,
    bodyHtml: paragraph(escapeHtml(d.detail)) + paragraph(escapeHtml(since)),
    bodyText: `${d.detail}\n\n${since}`,
    ...(d.link ? { button: { label: "Open runbook", href: d.link } } : {}),
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return { subject: headerValue(subject), preheader: subject, html, text };
}

// ---- P8 (08-10): staff hand-off emails (UI-SPEC "Staff emails"; D-UI-P8-27, -28) ----

const STAFF_WHY = "You're getting this because you're CDS staff.";
const TABLE_OPEN = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1B1B19">`;

/** Two-column facts table: muted 14px keys, body values, tabular figures. */
function factsTable(rows: readonly [string, string][]): string {
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;font-size:14px;color:#5B5B56;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>` +
        `<td style="padding:4px 0;font-variant-numeric:tabular-nums">${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  return `${TABLE_OPEN}${body}</table>`;
}

function factsText(rows: readonly [string, string][]): string[] {
  return rows.map(([k, v]) => `${k}  ${v}`);
}

function heading(label: string): string {
  return `<p style="margin:16px 0 4px;font-size:16px;font-weight:600;line-height:1.5;color:#1B1B19">${escapeHtml(label)}</p>`;
}

/** One plain line each, under a heading; an empty list renders nothing. */
function listSection(
  label: string,
  items: readonly string[],
): { html: string; text: string[] } {
  if (items.length === 0) return { html: "", text: [] };
  return {
    html: heading(label) + paragraph(items.map(escapeHtml).join("<br>")),
    text: ["", label, ...items],
  };
}

/** "Home", "Home and About", "Home, About and Services". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function siteAssembled(
  d: EmailData["site.assembled"],
  o: RenderOptions,
): RenderedParts {
  const n = d.polish.length;
  const subject = `Site assembled: ${d.businessName} (${n > 0 ? `${n} to polish` : "ready to review"})`;
  const labels = d.pages.map((p) => p.label);
  const where =
    labels.length === 0
      ? "The pages are on the preview address."
      : `${andList(labels)} ${labels.length === 1 ? "is" : "are"} on the preview address.`;
  const preheader = `${d.pathLabel} · ${d.businessTypeLabel} · ${where}`;
  const intro = `${d.businessName}'s site assembled from their answers. Review it, polish what's flagged, and it's ready for the owner.`;
  const facts: [string, string][] = [
    ["Business", d.businessName],
    ["Path", d.pathLabel],
    ["Business type", d.businessTypeLabel],
    ["Template", `${d.templateId} (v${d.templateVersion})`],
    ["Assembled", staffDateTime(d.assembledAt)],
    ["Org", d.orgId],
  ];
  const pagesHtml =
    d.pages.length === 0
      ? ""
      : heading("Pages") +
        TABLE_OPEN +
        d.pages
          .map(
            (p) =>
              `<tr><td style="padding:4px 16px 4px 0;white-space:nowrap;vertical-align:top">${escapeHtml(p.label)}</td>` +
              `<td style="padding:4px 0;word-break:break-all">${textLink(p.url, p.url)}</td></tr>`,
          )
          .join("") +
        `</table>`;
  // Full URLs on their own lines in the text part (UI-SPEC "Staff emails").
  const pagesText =
    d.pages.length === 0
      ? []
      : ["", "Pages", ...d.pages.flatMap((p) => [p.label, p.url])];
  const polish = listSection("To polish", d.polish);
  const filled = listSection("Filled", d.filled);
  const leftOut = listSection("Left out", d.leftOut);
  const after = `To polish: impersonate the owner from the staff tools and edit in the builder. After a fix to the template, re-run with npm run site:assemble -- --org ${d.orgId} --rerun; pages anyone has edited are left alone.`;
  const first = d.pages[0];
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml:
      paragraph(escapeHtml(intro)) +
      factsTable(facts) +
      pagesHtml +
      polish.html +
      filled.html +
      leftOut.html,
    bodyText: [
      intro,
      "",
      ...factsText(facts),
      ...pagesText,
      ...polish.text,
      ...filled.text,
      ...leftOut.text,
    ].join("\n"),
    ...(first
      ? { button: { label: "Open the preview", href: first.url } }
      : {}),
    afterHtml: paragraph(escapeHtml(after), true),
    afterText: after,
    footerHtml: paragraph(escapeHtml(STAFF_WHY), true),
    footerText: STAFF_WHY,
  });
  return { subject: headerValue(subject), preheader, html, text };
}

function siteAssemblyFailed(
  d: EmailData["site.assembly_failed"],
  o: RenderOptions,
): RenderedParts {
  const subject = `Site didn't assemble: ${d.businessName}`;
  const preheader = `Stopped after ${d.attempts} tries. The owner hasn't been told.`;
  const body = `${d.businessName}'s site stopped assembling after ${d.attempts} tries. The owner hasn't been told; their setup page still says CDS has their details.`;
  const facts: [string, string][] = [
    ["Error", d.errorCode],
    ["Page", d.page],
    [
      "Finished pages",
      d.finishedPages.length > 0 ? d.finishedPages.join(", ") : "None",
    ],
    ["Last try", staffDateTime(d.lastTry)],
    ["Org", d.orgId],
  ];
  const next = `Look up the error code in the log, fix the cause, then run npm run site:assemble -- --org ${d.orgId}. It picks up where it stopped and never duplicates a page.`;
  // No button (D-UI-P8-28): the fix is a command.
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml:
      paragraph(escapeHtml(body)) +
      factsTable(facts) +
      paragraph(escapeHtml(next)),
    bodyText: [body, "", ...factsText(facts), "", next].join("\n"),
    footerHtml: paragraph(escapeHtml(STAFF_WHY), true),
    footerText: STAFF_WHY,
  });
  return { subject: headerValue(subject), preheader, html, text };
}

function agreementSigned(
  d: EmailData["agreement.signed"],
  o: RenderOptions,
): RenderedParts {
  const intro = `Hi ${d.firstName}, here's a record of the agreement you signed for ${d.orgName} on ${d.signedDate} at ${d.signedTime}.`;
  const list =
    d.policies.length === 0
      ? ""
      : `<ul style="margin:0 0 16px;padding:0 0 0 20px;font-size:16px;line-height:1.5;color:#1B1B19">` +
        d.policies.map((p) => `<li>${escapeHtml(p)}</li>`).join("") +
        `</ul>`;
  const afterLead =
    "You can also find it in Settings › Legal. If you ever need to show the agreement wasn't changed, its proof code is:";
  const why = "You're getting this because you signed an agreement with CDS.";
  const preheader = `Signed ${d.signedDate} for ${d.orgName}. Download your copy any time.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: paragraph(escapeHtml(intro)) + list,
    bodyText: [intro, "", ...d.policies].join("\n"),
    button: { label: "Download your signed copy", href: d.link },
    afterHtml: paragraph(
      `${escapeHtml(afterLead)} <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;word-break:break-all">${escapeHtml(d.proofCode)}</span>.`,
    ),
    afterText: `${afterLead} ${d.proofCode}.`,
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return {
    subject: headerValue("Your signed CDS agreement"),
    preheader,
    html,
    text,
  };
}

// ---- P10 (10-03): billing emails (UI-SPEC "Emails"; D214, D310; owner words only) ----

const BILLING_WHY = "You're getting this because you have a website with CDS.";

const EXACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,539.00": bills and receipts always show cents (UI-SPEC Emails). */
function exactMoney(cents: number): string {
  return EXACT.format(cents / 100);
}

/** Drop one trailing period so a caller's sentence never doubles it. */
function sentence(s: string): string {
  return s.trim().replace(/\.$/, "");
}

type OwnerEmail = {
  subject: string;
  preheader: string;
  body: readonly string[];
  extraHtml?: string;
  extraText?: readonly string[];
  tail?: readonly string[];
  button: { label: string; href: string };
};

/** The shared owner billing shape: paragraphs, optional table, one button, fixed footer. */
function ownerBilling(e: OwnerEmail, o: RenderOptions): RenderedParts {
  const tail = e.tail ?? [];
  const { html, text } = layout({
    brand: o.brand,
    preheader: e.preheader,
    bodyHtml:
      e.body.map((p) => paragraph(escapeHtml(p))).join("") +
      (e.extraHtml ?? "") +
      tail.map((p) => paragraph(escapeHtml(p))).join(""),
    bodyText: [
      e.body.join("\n\n"),
      ...(e.extraText && e.extraText.length > 0 ? ["", ...e.extraText] : []),
      ...(tail.length > 0 ? ["", tail.join("\n\n")] : []),
    ].join("\n"),
    button: e.button,
    footerHtml: paragraph(escapeHtml(BILLING_WHY), true),
    footerText: BILLING_WHY,
  });
  return {
    subject: headerValue(e.subject),
    preheader: e.preheader,
    html,
    text,
  };
}

function billingReceipt(
  d: EmailData["billing.receipt"],
  o: RenderOptions,
): RenderedParts {
  const paid = exactMoney(d.paidCents);
  const rows: [string, string][] = d.lines.map((l) => [
    l.label,
    exactMoney(l.cents),
  ]);
  return ownerBilling(
    {
      subject: "Your receipt from CDS",
      preheader: `${paid} paid on ${d.paidOn}.`,
      body: [
        `Thanks, ${d.firstName}. We received ${paid} (including ${exactMoney(d.taxCents)} sales tax) for ${d.orgName}'s website.`,
      ],
      extraHtml: rows.length > 0 ? factsTable(rows) : "",
      extraText: factsText(rows),
      tail: d.nextBill
        ? [`Next bill: ${d.nextBill.date}, ${exactMoney(d.nextBill.cents)}.`]
        : [],
      button: { label: "View invoice", href: d.invoiceUrl },
    },
    o,
  );
}

function billingCardFailed(
  d: EmailData["billing.card_failed"],
  o: RenderOptions,
): RenderedParts {
  return ownerBilling(
    {
      subject: "Your card payment didn't go through",
      preheader: "Update your card to keep your add-ons on.",
      body: [
        `Your payment of ${exactMoney(d.amountCents)} for ${d.orgName} on ${d.date} didn't go through. Your site and add-ons are still on. Stripe will try again over the next few days; updating your card now fixes it straight away.`,
      ],
      button: { label: "Update card", href: d.updateUrl },
    },
    o,
  );
}

function billingLapsed(
  d: EmailData["billing.lapsed"],
  o: RenderOptions,
): RenderedParts {
  const named = d.addons.length > 0;
  const paused = named
    ? `${d.orgName}'s add-ons are paused: ${d.addons.join(", ")}.`
    : `${d.orgName}'s add-ons are paused.`;
  const kept = named
    ? `everything in ${andList(d.addons)} is kept`
    : "everything in your add-ons is kept";
  return ownerBilling(
    {
      subject: "Your add-ons are paused",
      preheader: "Your pages are still live. Nothing was deleted.",
      body: [
        `We couldn't collect ${exactMoney(d.amountCents)} after several tries, so ${paused} Your site's pages are still live, and ${kept}. Pay the overdue amount and everything comes back as it was.`,
      ],
      button: { label: "Update card and pay", href: d.payUrl },
    },
    o,
  );
}

function billingRestored(
  d: EmailData["billing.restored"],
  o: RenderOptions,
): RenderedParts {
  const what =
    d.addons.length === 0
      ? "your add-ons are"
      : `${andList(d.addons)} ${d.addons.length === 1 ? "is" : "are"}`;
  return ownerBilling(
    {
      subject: "Your add-ons are back on",
      preheader: "Payment received. Thank you.",
      body: [
        `We received your payment, and ${what} back on your site exactly as ${d.addons.length === 1 ? "it was" : "they were"}.`,
      ],
      button: { label: "Open your hub", href: d.hubUrl },
    },
    o,
  );
}

function billingQuoteSent(
  d: EmailData["billing.quote_sent"],
  o: RenderOptions,
): RenderedParts {
  const total = formatCents(d.totalCents);
  const deposit =
    d.depositCents !== null && d.depositCents > 0
      ? `, deposit today ${formatCents(d.depositCents)}`
      : "";
  const scope = sentence(d.scopeLine);
  return ownerBilling(
    {
      subject: `CDS sent you a quote: ${d.title}`,
      preheader: `${total}. Valid until ${d.validUntil}.`,
      body: [
        `Here's the quote you asked for: ${sentence(d.title)}.${scope ? ` ${scope}.` : ""} Price ${total}${deposit}. No work starts until you accept it.`,
      ],
      button: { label: "Review quote", href: d.quoteUrl },
    },
    o,
  );
}

function billingStripeSetup(
  d: EmailData["billing.stripe_setup"],
  o: RenderOptions,
): RenderedParts {
  return ownerBilling(
    {
      subject: "Finish setting up Stripe",
      preheader: "Online payments are paused on your site.",
      body: [
        "Stripe has paused payments on your account, so customers can't pay online right now. They can still book and pay in person. Finish what Stripe asks for to turn online payments back on.",
      ],
      button: { label: "Finish Stripe setup", href: d.setupUrl },
    },
    o,
  );
}

/**
 * UI-SPEC reason sentences (D-UI-P10-20). `other` is the staff note, reviewed in the CLI.
 * Exported so the hub's declined notice (10-28 readDeclinedNotice) shows the same sentence.
 */
export const DECLINE_REASON_SENTENCES: Readonly<
  Record<Exclude<EmailData["org.declined"]["reason"], "other">, string>
> = {
  fit: "Your business is a kind of site we don't host.",
  capacity:
    "We can't take on your build right now and didn't want to keep you waiting.",
  scope: "What your site needs is outside what CDS builds.",
};

/** The reason sentence for a category; `other` is the note as one sentence ("" when empty). */
export function declineReasonSentence(
  reason: EmailData["org.declined"]["reason"],
  otherNote: string | null,
): string {
  if (reason !== "other") return DECLINE_REASON_SENTENCES[reason];
  const note = otherNote?.trim() ?? "";
  return note ? `${sentence(note)}.` : "";
}

function orgDeclined(
  d: EmailData["org.declined"],
  o: RenderOptions,
): RenderedParts {
  const reason = declineReasonSentence(d.reason, d.otherNote);
  const body = `CDS can't build this site, so we've refunded everything you paid, ${exactMoney(d.refundedCents)}, to your card. It can take 5 to 10 business days to show.${reason ? ` ${reason}` : ""}`;
  const keep = `Your preview site is offline. Your account and site details are deleted on ${d.deleteOn}. Your signed agreement and receipts are kept for our records, and you can download them until then.`;
  return ownerBilling(
    {
      subject: "About your CDS order",
      preheader: "We've refunded your payment in full.",
      body: [body, keep],
      button: { label: "Download your signed agreement", href: d.agreementUrl },
    },
    o,
  );
}

const STAFF_ALERT_SUBJECTS: Record<
  EmailData["billing.staff_alert"]["event"],
  (org: string) => string
> = {
  stripe_restricted: (org) => `Stripe restricted: ${org}`,
  stripe_disconnected: (org) => `Stripe disconnected: ${org}`,
  unpriced_item: (org) => `Unpriced item on an order: ${org}`,
  payments_unavailable: (org) => `Payments unavailable: ${org}`,
  webhook_failed: (org) => `Stripe webhook failed: ${org}`,
  reconcile_failed: (org) => `Billing reconcile failed: ${org}`,
  quote_declined: (org) => `Quote declined: ${org}`,
  duplicate_checkout: (org) => `Second checkout paid: ${org}`,
  stray_checkout: (org) => `Old checkout paid: ${org}`,
  provider_id_conflict: (org) => `Payment id on two sites: ${org}`,
};

/** Staff only (choice 1): sent as CDS to staffAlertAddress(); no owner link, no button. */
function billingStaffAlert(
  d: EmailData["billing.staff_alert"],
  o: RenderOptions,
): RenderedParts {
  const subject = STAFF_ALERT_SUBJECTS[d.event](d.orgName);
  const facts: [string, string][] = [
    ["Event", d.event],
    ["Org", d.orgName],
    ["Org id", d.orgId],
    ["Detail", d.detail],
  ];
  const { html, text } = layout({
    brand: o.brand,
    preheader: subject,
    bodyHtml: factsTable(facts),
    bodyText: factsText(facts).join("\n"),
    footerHtml: paragraph(escapeHtml(STAFF_WHY), true),
    footerText: STAFF_WHY,
  });
  return { subject: headerValue(subject), preheader: subject, html, text };
}

// ---- P11 (11-10) owner emails: alerts, morning summary, monthly report, download, invite ----

const NUM = new Intl.NumberFormat("en-US");

/** "7 Oct, 2:14 pm" in the business's time zone. */
function sentTime(d: Date, timeZone = "America/Chicago"): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(d);
  return `${day}, ${time}`;
}

function alertsFooter(
  what: string,
  settingsHref: string,
): { footerHtml: string; footerText: string } {
  const lead = `You get this because ${what} are on. Change your alerts:`;
  return {
    footerHtml: paragraph(
      `${escapeHtml(lead)} ${textLink("Alert settings", settingsHref)}`,
      true,
    ),
    footerText: `${lead} ${safeHref(settingsHref)}`,
  };
}

/** Subject and body line are the safe title in sensitive-practice mode (DASH-37, T-11-10-01). */
function alertNotify(
  d: EmailData["alert.notify"],
  o: RenderOptions,
): RenderedParts {
  const line = d.sensitive ? d.safeTitle : d.title;
  if (typeof line !== "string" || !line.trim()) {
    throw new Error("alert.notify needs a title");
  }
  const sent = `Sent ${sentTime(d.sentAt, d.timeZone)}.`;
  const preheader = `${d.business} · ${d.section}`;
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: paragraph(escapeHtml(line)) + paragraph(escapeHtml(sent), true),
    bodyText: `${line}\n\n${sent}`,
    button: { label: d.actionLabel, href: d.href },
    ...alertsFooter(`${d.alertLabel} alerts`, d.settingsHref),
  });
  return { subject: headerValue(line), preheader, html, text };
}

/** Never rendered empty: the job skips a day with nothing to say (UI-SPEC "skipped when empty"). */
function alertsDigest(
  d: EmailData["alerts.digest"],
  o: RenderOptions,
): RenderedParts {
  if (d.lines.length === 0) {
    throw new Error("alerts.digest has no lines; skip the send");
  }
  const lines = d.lines.map((l) => {
    if (!d.sensitive) return l.text;
    // Fail closed: a sensitive digest never falls back to the full line.
    if (typeof l.safeText !== "string" || !l.safeText.trim()) {
      throw new Error("alerts.digest: a sensitive line needs safeText");
    }
    return l.safeText;
  });
  const n = d.lines.reduce(
    (sum, l) => sum + (typeof l.count === "number" ? l.count : 1),
    0,
  );
  const preheader = `${NUM.format(n)} ${n === 1 ? "thing" : "things"} from yesterday.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: lines.map((l) => paragraph(escapeHtml(l))).join(""),
    bodyText: lines.join("\n"),
    button: { label: "Open Today", href: d.href },
    ...alertsFooter("morning summary alerts", d.settingsHref),
  });
  return {
    subject: headerValue(`Your morning summary for ${d.business}`),
    preheader,
    html,
    text,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${NUM.format(n)} ${n === 1 ? one : many}`;
}

function reportsMonthly(
  d: EmailData["reports.monthly"],
  o: RenderOptions,
): RenderedParts {
  if (d.lines.length !== 5) {
    throw new Error("reports.monthly needs exactly five lines");
  }
  const preheader = `${plural(d.visitors, "visitor", "visitors")} and ${plural(d.messages, "message", "messages")}.`;
  const tip = `One tip: ${sentence(d.tip)}.`;
  const why =
    "Sent to your team on the 1st of each month. Turn it off in your profile.";
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml:
      d.lines.map((l) => paragraph(escapeHtml(l))).join("") +
      paragraph(escapeHtml(tip)),
    bodyText: [d.lines.join("\n"), "", tip].join("\n"),
    button: { label: "See your Site Report", href: d.href },
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return {
    subject: headerValue(`Your site this month: ${d.month}`),
    preheader,
    html,
    text,
  };
}

function dataExportReady(
  d: EmailData["data_export.ready"],
  o: RenderOptions,
): RenderedParts {
  const body = `Your download of ${d.business}'s data is ready: a spreadsheet for each kind of record and a zip of your media. The link works until ${d.expiresOn}.`;
  const why = `You're getting this because you asked for a download of ${d.business}'s data.`;
  const preheader = "The link works for 7 days.";
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: paragraph(escapeHtml(body)),
    bodyText: body,
    button: { label: "Download your data", href: d.href },
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return {
    subject: headerValue("Your data download is ready"),
    preheader,
    html,
    text,
  };
}

function bookingNotice(
  d: EmailData["booking.notice"],
  o: RenderOptions,
): RenderedParts {
  const { html, text } = layout({
    brand: o.brand,
    preheader: d.lead,
    bodyHtml: paragraph(escapeHtml(d.lead)) + factsTable(d.facts),
    bodyText: [d.lead, "", ...factsText(d.facts)].join("\n"),
    ...(d.button ? { button: d.button } : {}),
    footerHtml: paragraph(escapeHtml(d.why), true),
    footerText: d.why,
  });
  return { subject: headerValue(d.subject), preheader: d.lead, html, text };
}

/** "an Editor", "an Admin", "a Viewer". */
function withArticle(role: string): string {
  const r = role.trim();
  return /^[aeiou]/i.test(r) ? `an ${r}` : `a ${r}`;
}

function memberInvite(
  d: EmailData["member.invite"],
  o: RenderOptions,
): RenderedParts {
  const as = withArticle(d.role);
  const body = `${d.inviterName} invited you to help run ${d.business}'s website as ${as}. The invite works for 7 days.`;
  const why = `You're getting this because ${d.inviterName} invited you. If you weren't expecting it, you can ignore this email; the invite ends on ${d.expiresOn}.`;
  const preheader = `Join as ${as}.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: paragraph(escapeHtml(body)),
    bodyText: body,
    button: { label: `Join ${d.business}`, href: d.href },
    footerHtml: paragraph(escapeHtml(why), true),
    footerText: why,
  });
  return {
    subject: headerValue(
      `${d.inviterName} invited you to help with ${d.business}'s website`,
    ),
    preheader,
    html,
    text,
  };
}

// ---- P12 CDS Support (12-05; UI-SPEC Emails; COMM-10, D97). Every one ends with NO-REPLY-FOOTER.

const EXCERPT_MAX = 300;
const NO_REPLY = SUPPORT_COPY.NO_REPLY_FOOTER;

function excerptOf(v: string | undefined): string {
  const s = (v ?? "").trim();
  return s.length > EXCERPT_MAX ? s.slice(0, EXCERPT_MAX) : s;
}

function whoFromCds(first: string | undefined): string {
  const n = headerValue(first ?? "").trim();
  return n ? `${n} from CDS` : "CDS";
}

const STATUS_BODY: Readonly<Partial<Record<TicketStatus, string>>> = {
  waiting_on_you: "CDS needs something from you to continue.",
  resolved:
    "CDS marked this resolved. If it isn't, reply in your hub within 7 days to reopen it.",
  closed: "This ticket is closed. Open a new one any time.",
};

type SupportShape = {
  subject: string;
  preheader: string;
  lines: string[];
  button: string;
};

function needTicket(
  d: SupportEmailVars,
): NonNullable<SupportEmailVars["ticket"]> {
  const t = d.ticket;
  if (!t || !Number.isInteger(t.number) || t.number <= 0) {
    throw new Error(`${d.kind} email needs a ticket`);
  }
  return t;
}

function needTitle(d: SupportEmailVars): string {
  const t = (d.title ?? "").trim();
  if (!t) throw new Error(`${d.kind} email needs a title`);
  return t;
}

function supportShape(d: SupportEmailVars): SupportShape {
  const excerpt = excerptOf(d.excerpt);
  switch (d.kind) {
    case "support.reply": {
      const t = needTicket(d);
      return {
        subject: replySubject(t.number),
        preheader: t.subject,
        lines: [
          `${whoFromCds(d.authorFirstName)} replied to your ticket "${t.subject}".`,
          excerpt,
        ],
        button: "Read the reply",
      };
    }
    case "support.status": {
      const t = needTicket(d);
      if (!t.status) throw new Error("support.status email needs a status");
      return {
        subject: statusSubject(t.number, t.status),
        preheader: t.subject,
        lines: [
          STATUS_BODY[t.status] ?? `${statusSubject(t.number, t.status)}.`,
        ],
        button: "Open the ticket",
      };
    }
    case "cds.message":
      return {
        subject: "New message from CDS",
        preheader: d.business,
        lines: [`${whoFromCds(d.authorFirstName)} wrote:`, excerpt],
        button: "Read the message",
      };
    case "cds.note":
      return {
        subject: `A note from CDS: ${needTitle(d)}`,
        preheader: d.business,
        lines: [excerpt],
        button: "Read the note",
      };
    case "cds.document": {
      // No attachment and no link to the file itself; the excerpt is never used.
      const title = needTitle(d);
      return {
        subject: `CDS shared a document: ${title}`,
        preheader: d.business,
        lines: [`${title} is in Documents in your hub.`],
        button: "Open Documents",
      };
    }
    case "cds.notice":
      return {
        subject: needTitle(d),
        preheader: d.business,
        lines: [excerpt],
        button: "Open your hub",
      };
    case "cds.idea_built": {
      // 12-REVIEW CR-A01: its own copy (it used to read "New message from CDS").
      const title = needTitle(d);
      return {
        subject: `An idea you voted for is built: ${title}`,
        preheader: d.business,
        lines: [`"${title}" is now built. Thank you for voting for it.`],
        button: "See the idea",
      };
    }
    default:
      throw new Error("unknown support email kind");
  }
}

function noReplyFooter(extra?: string): {
  footerHtml: string;
  footerText: string;
} {
  const lines = extra ? [extra, NO_REPLY] : [NO_REPLY];
  return {
    footerHtml: lines.map((l) => paragraph(escapeHtml(l), true)).join(""),
    footerText: lines.join("\n"),
  };
}

/**
 * RATING-Q with two plain text links (UI-SPEC line 1000): only on support.status Resolved
 * with signed links from 13-16. Never a second button.
 */
function ratingPart(d: SupportEmailVars): { html: string; text: string } {
  const links = d.ratingLinks;
  if (
    !links ||
    d.kind !== "support.status" ||
    d.ticket?.status !== "resolved"
  ) {
    return { html: "", text: "" };
  }
  const q = P13_COPY.RATING_Q;
  return {
    html: paragraph(
      `${escapeHtml(q)} ${textLink(P13_COPY.RATING_YES, links.up)} · ${textLink(P13_COPY.RATING_NO, links.down)}`,
    ),
    text: `\n\n${q}\n${P13_COPY.RATING_YES}: ${safeHref(links.up)}\n${P13_COPY.RATING_NO}: ${safeHref(links.down)}`,
  };
}

function supportNotify(d: SupportEmailVars, o: RenderOptions): RenderedParts {
  const s = supportShape(d);
  const lines = s.lines.filter((l) => l.trim() !== "");
  const rating = ratingPart(d);
  const { html, text } = layout({
    brand: o.brand,
    preheader: s.preheader,
    bodyHtml: lines.map((l) => paragraph(multiline(l))).join("") + rating.html,
    bodyText: lines.join("\n\n") + rating.text,
    button: { label: s.button, href: d.href },
    ...noReplyFooter(),
  });
  return {
    subject: headerValue(s.subject),
    preheader: s.preheader,
    html,
    text,
  };
}

/** Staff only: plain facts and the CLI line, no button (UI-SPEC line 678). */
function supportSlaRisk(
  d: EmailData["support.sla_risk"],
  o: RenderOptions,
): RenderedParts {
  if (!Number.isInteger(d.ticketNumber) || d.ticketNumber <= 0) {
    throw new Error("support.sla_risk needs a ticket number");
  }
  const rows: [string, string][] = [
    ["Ticket", `#${d.ticketNumber}`],
    ["Site", d.business],
    ["Type", d.typeLabel],
    ["Age", d.age],
    ["Due", d.due],
  ];
  const cmd = `npm run support:show -- --ticket ${d.ticketNumber}`;
  const lead = "A ticket is close to missing its 2-business-day reply.";
  const preheader = `Due ${d.due}`;
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml:
      paragraph(escapeHtml(lead)) +
      factsTable(rows) +
      paragraph(escapeHtml(cmd)),
    bodyText: [lead, "", ...factsText(rows), "", cmd].join("\n"),
    ...noReplyFooter(STAFF_WHY),
  });
  return {
    subject: headerValue(`SLA at risk: #${d.ticketNumber} · ${d.business}`),
    preheader,
    html,
    text,
  };
}

// ---- P13 (13-02; P13-P17, UI-SPEC Emails lines 990-1001). Staff mail is sent as CDS,
// no-reply, to staffAlertAddress(); owner mail as CDS to Owners and Admins; one button max.

const CT_WEEKDAY_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "America/Chicago",
});

/** "Thu 16 Oct" in America/Chicago (UI-SPEC suspension subject). */
export function ctWeekdayDate(d: Date): string {
  return CT_WEEKDAY_DAY.format(d).replace(",", "");
}

const REPORTER_WHY = "You're getting this because you sent a report to CDS.";

function needPositiveInt(n: number, what: string): void {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${what} is required`);
}

function staffHealthAlert(
  d: EmailData["staff.health_alert"],
  o: RenderOptions,
): RenderedParts {
  const levelWord = d.level === "critical" ? "Critical" : "Warning";
  const subject =
    d.state === "open"
      ? `${levelWord}: ${d.component} ${d.reading}`
      : `Resolved: ${d.component}`;
  const lead =
    d.state === "open"
      ? `${d.component} crossed its ${levelWord.toLowerCase()} threshold.`
      : `${d.component} is back within its threshold.`;
  const rows: [string, string][] = [
    ["Component", d.component],
    ["Reading", d.reading],
    ["Threshold", d.threshold],
    ["Since", staffDateTime(d.since)],
  ];
  const { html, text } = layout({
    brand: o.brand,
    preheader: subject,
    bodyHtml: paragraph(escapeHtml(lead)) + factsTable(rows),
    bodyText: [lead, "", ...factsText(rows)].join("\n"),
    button: { label: "Open Health", href: d.href },
    ...noReplyFooter(STAFF_WHY),
  });
  return { subject: headerValue(subject), preheader: subject, html, text };
}

function supportRatingDown(
  d: EmailData["support.rating_down"],
  o: RenderOptions,
): RenderedParts {
  needPositiveInt(d.ticketNumber, "support.rating_down ticket number");
  const comment = (d.comment ?? "").trim();
  const rows: [string, string][] = [
    ["Ticket", `#${d.ticketNumber} ${d.subject}`],
    ["Site", d.business],
    ["Agent", d.agent.trim() || "Unassigned"],
    ["Comment", comment ? excerptOf(comment) : P13_COPY.MAIL_NO_COMMENT],
    ["Resolved", staffDateTime(d.resolvedAt)],
  ];
  const subject = `Thumbs down on #${d.ticketNumber} · ${d.business}`;
  const { html, text } = layout({
    brand: o.brand,
    preheader: d.subject,
    bodyHtml: factsTable(rows),
    bodyText: factsText(rows).join("\n"),
    button: { label: `Open ticket #${d.ticketNumber}`, href: d.href },
    ...noReplyFooter(STAFF_WHY),
  });
  return {
    subject: headerValue(subject),
    preheader: d.subject,
    html,
    text,
  };
}

function scanBudgetCap(
  d: EmailData["scan.budget_cap"],
  o: RenderOptions,
): RenderedParts {
  const subject = `Link check cap reached for ${d.month}`;
  const lead =
    "Web Risk link checks stopped for the rest of the month. New links are marked Not checked.";
  const rows: [string, string][] = [
    ["Month", d.month],
    ["Checks used", NUM.format(d.used)],
    ["Monthly cap", NUM.format(d.cap)],
  ];
  const how = "To raise it, set CDS_WEBRISK_MONTHLY_CAP and restart the app.";
  const { html, text } = layout({
    brand: o.brand,
    preheader: subject,
    bodyHtml:
      paragraph(escapeHtml(lead)) +
      factsTable(rows) +
      paragraph(escapeHtml(how)),
    bodyText: [lead, "", ...factsText(rows), "", how].join("\n"),
    ...noReplyFooter(STAFF_WHY),
  });
  return { subject: headerValue(subject), preheader: subject, html, text };
}

function siteSuspensionNotice(
  d: EmailData["site.suspension_notice"],
  o: RenderOptions,
): RenderedParts {
  const when = ctWeekdayDate(d.fixBy);
  return ownerBilling(
    {
      subject: `Action needed on ${d.business} by ${when}`,
      preheader: fillCopy(P13_COPY.SUSP_NOTICE, { when }),
      body: [
        fillCopy(P13_COPY.SUSP_NOTICE, { when }),
        d.whatToFix.trim(),
        P13_COPY.MAIL_MISTAKE_LINE,
      ].filter(Boolean),
      button: { label: "See what to fix", href: d.href },
    },
    o,
  );
}

function siteSuspended(
  d: EmailData["site.suspended"],
  o: RenderOptions,
): RenderedParts {
  const offline = fillCopy(P13_COPY.SUSP_OFFLINE, {
    date: shortDate(d.suspendedAt),
  });
  return ownerBilling(
    {
      subject: `${d.business} is offline`,
      preheader: offline,
      body: [offline, `Reason: ${d.reasonLabel}`],
      button: { label: "Open CDS Support", href: d.href },
    },
    o,
  );
}

function siteSuspensionLifted(
  d: EmailData["site.suspension_lifted"],
  o: RenderOptions,
): RenderedParts {
  return ownerBilling(
    {
      subject: `${d.business} is back online`,
      preheader: P13_COPY.MAIL_BACK_ONLINE,
      body: [P13_COPY.MAIL_BACK_ONLINE],
      button: { label: "Open your hub", href: d.href },
    },
    o,
  );
}

function reportContentNotice(
  d: EmailData["report.content_notice"],
  o: RenderOptions,
): RenderedParts {
  const lead = `Someone reported a page on ${d.business} to CDS. CDS reviews every report, usually within 2 business days, and tells you if anything needs to change.`;
  const rows: [string, string][] = [
    ["Page", d.url],
    ["Reason", d.categoryLabel],
  ];
  const subject = `A page on ${d.business} was reported`;
  const { html, text } = layout({
    brand: o.brand,
    preheader: subject,
    bodyHtml: paragraph(escapeHtml(lead)) + factsTable(rows),
    bodyText: [lead, "", ...factsText(rows)].join("\n"),
    button: { label: "Open your hub", href: d.href },
    footerHtml: paragraph(escapeHtml(BILLING_WHY), true),
    footerText: BILLING_WHY,
  });
  return { subject: headerValue(subject), preheader: subject, html, text };
}

function reportReceived(
  d: EmailData["report.received"],
  o: RenderOptions,
): RenderedParts {
  const code = d.caseCode.trim();
  if (!/^R-\d+$/.test(code))
    throw new Error("report.received needs a case code");
  const rows: [string, string][] = [
    ["Report", code],
    ["Page", d.url],
    ["Reason", d.categoryLabel],
  ];
  const subject = `We received your report ${code}`;
  const lead = P13_COPY.MAIL_REPORT_REVIEW;
  const { html, text } = layout({
    brand: o.brand,
    preheader: lead,
    bodyHtml: paragraph(escapeHtml(lead)) + factsTable(rows),
    bodyText: [lead, "", ...factsText(rows)].join("\n"),
    footerHtml: paragraph(escapeHtml(REPORTER_WHY), true),
    footerText: REPORTER_WHY,
  });
  return { subject: headerValue(subject), preheader: lead, html, text };
}

/** Staff only (15-03): the facts, then the message with its line breaks; no button. */
function hubInquiry(
  d: EmailData["hub.inquiry"],
  o: RenderOptions,
): RenderedParts {
  const name = d.name.trim();
  const message = d.message.trim();
  if (!name || !message)
    throw new Error("hub.inquiry needs a name and message");
  const subject = `Hub contact (${d.topicLabel}): ${name}`;
  const facts: [string, string][] = [
    ["Name", name],
    ["Email", d.email],
  ];
  if (d.business.trim()) facts.push(["Business", d.business.trim()]);
  facts.push(["Topic", d.topicLabel]);
  if (d.phone.trim()) facts.push(["Phone", d.phone.trim()]);
  if (d.about.trim()) facts.push(["About", d.about.trim()]);
  const lead =
    "Someone sent the contact form on the CDS site. Reply to this email to answer them.";
  const { html, text } = layout({
    brand: o.brand,
    preheader: subject,
    bodyHtml:
      paragraph(escapeHtml(lead)) +
      factsTable(facts) +
      heading("Message") +
      paragraph(multiline(message)),
    bodyText: [lead, "", ...factsText(facts), "", "Message", message].join(
      "\n",
    ),
    footerHtml: paragraph(escapeHtml(STAFF_WHY), true),
    footerText: STAFF_WHY,
  });
  return { subject: headerValue(subject), preheader: subject, html, text };
}

// ---- P14 (14-03; 14-UI-SPEC "Emails"): owner mail as CDS with the P6 layout and one button
// max; the nameserver steps go to a typed address with no button; staff mail to
// staffAlertAddress() as CDS, no-reply.

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "14 Nov 2026" (UTC). */
export function longDate(d: Date): string {
  return LONG_DATE.format(d);
}

const NOTE_MAX = 500;
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

type P14OwnerMail = {
  subject: string;
  body: readonly string[];
  button?: { label: string; href: string };
};

/** Owner mail: paragraphs, an optional single button, the CDS footer. */
function p14Owner(e: P14OwnerMail, o: RenderOptions): RenderedParts {
  const preheader = e.body[0] ?? e.subject;
  const { html, text } = layout({
    brand: o.brand,
    preheader,
    bodyHtml: e.body.map((p) => paragraph(escapeHtml(p))).join(""),
    bodyText: e.body.join("\n\n"),
    ...(e.button ? { button: e.button } : {}),
    footerHtml: paragraph(escapeHtml(BILLING_WHY), true),
    footerText: BILLING_WHY,
  });
  return { subject: headerValue(e.subject), preheader, html, text };
}

function domainRecordsCopied(
  d: EmailData["domain.records_copied"],
  o: RenderOptions,
): RenderedParts {
  return p14Owner(
    {
      subject: P14_COPY.MAIL_RECORDS_COPIED_S(d),
      body: [P14_COPY.MAIL_RECORDS_COPIED_B(d), P14_COPY.COPY_SAFE(d)],
      button: { label: "See the steps", href: d.href },
    },
    o,
  );
}

function domainNameserverSteps(
  d: EmailData["domain.nameserver_steps"],
  o: RenderOptions,
): RenderedParts {
  const ns = d.nameservers.map((x) => x.trim().toLowerCase());
  if (ns.length !== 2 || !ns.every((x) => HOSTNAME.test(x))) {
    throw new Error("domain.nameserver_steps needs two nameservers");
  }
  const lead = P14_COPY.MAIL_STEPS_B(d);
  const note = (d.note ?? "").trim().slice(0, NOTE_MAX);
  const noteLine = note ? `Note from ${d.sender.trim()}: ${note}` : "";
  const replace = P14_COPY.NS_REPLACE(d);
  const steps = d.steps.map((s, i) => `${i + 1}. ${s.trim()}`);
  const stepsLabel = `Steps at ${d.registrar}`;
  const safe = P14_COPY.NS_SAFE;
  const why = `You're getting this because someone at ${d.business} entered your address. CDS never asks for a password.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader: lead,
    bodyHtml:
      paragraph(escapeHtml(lead)) +
      (noteLine ? paragraph(escapeHtml(noteLine)) : "") +
      heading("Nameservers") +
      paragraph(ns.map(escapeHtml).join("<br>")) +
      paragraph(escapeHtml(replace)) +
      (steps.length > 0
        ? heading(stepsLabel) + paragraph(steps.map(escapeHtml).join("<br>"))
        : "") +
      paragraph(escapeHtml(safe)),
    bodyText: [
      lead,
      ...(noteLine ? ["", noteLine] : []),
      "",
      "Nameservers",
      ...ns,
      "",
      replace,
      ...(steps.length > 0 ? ["", stepsLabel, ...steps] : []),
      "",
      safe,
    ].join("\n"),
    ...noReplyFooter(why),
  });
  return {
    subject: headerValue(P14_COPY.MAIL_STEPS_S(d)),
    preheader: lead,
    html,
    text,
  };
}

function domainConnected(
  d: EmailData["domain.connected"],
  o: RenderOptions,
): RenderedParts {
  return p14Owner(
    {
      subject: P14_COPY.MAIL_CONNECTED_S(d),
      body: [P14_COPY.MAIL_CONNECTED_B(d)],
      button: { label: "Open Domain settings", href: d.href },
    },
    o,
  );
}

function domainSwitchBack(
  d: EmailData["domain.switch_back"],
  o: RenderOptions,
): RenderedParts {
  needPositiveInt(d.count, "domain.switch_back count");
  return p14Owner(
    {
      subject: P14_COPY.MAIL_SWITCH_BACK_S(d),
      body: [P14_COPY.MISMATCH_B(d)],
      button: { label: "See what to do", href: d.href },
    },
    o,
  );
}

function domainLostDelegation(
  d: EmailData["domain.lost_delegation"],
  o: RenderOptions,
): RenderedParts {
  return p14Owner(
    {
      subject: P14_COPY.LOST_T(d),
      body: [P14_COPY.LOST_B(d)],
      button: { label: "See what to do", href: d.href },
    },
    o,
  );
}

function domainExpiry(
  d: EmailData["domain.expiry"],
  o: RenderOptions,
): RenderedParts {
  if (d.days !== 30 && d.days !== 7) {
    throw new Error("domain.expiry days must be 30 or 7");
  }
  const slots = { ...d, date: shortDate(d.expiresOn) };
  return p14Owner(
    {
      subject: P14_COPY.MAIL_EXPIRY_S(slots),
      body: [
        d.days === 7 ? P14_COPY.EXPIRY_7(slots) : P14_COPY.EXPIRY_30(slots),
      ],
      button: { label: "How to renew", href: d.href },
    },
    o,
  );
}

function reviewSent(
  _d: EmailData["review.sent"],
  o: RenderOptions,
): RenderedParts {
  return p14Owner(
    { subject: P14_COPY.MAIL_REVIEW_SENT_S, body: [P14_COPY.SUBMITTED_B] },
    o,
  );
}

function offboardingStarted(
  d: EmailData["offboarding.started"],
  o: RenderOptions,
): RenderedParts {
  return p14Owner(
    {
      subject: P14_COPY.MAIL_LEAVING_S,
      body: [P14_COPY.MAIL_LEAVING_B({ endsOn: longDate(d.endsOn) })],
      button: { label: "Open checklist", href: d.href },
    },
    o,
  );
}

function offboardingHandedBack(
  _d: EmailData["offboarding.handed_back"],
  o: RenderOptions,
): RenderedParts {
  return p14Owner(
    { subject: P14_COPY.MAIL_HANDED_BACK_S, body: [P14_COPY.HANDBACK_DONE] },
    o,
  );
}

function offboardingHandbackOverdue(
  d: EmailData["offboarding.handback_overdue"],
  o: RenderOptions,
): RenderedParts {
  return p14Owner(
    {
      subject: P14_COPY.MAIL_HANDBACK_OVERDUE_S,
      body: [P14_COPY.MAIL_HANDBACK_OVERDUE_B],
      button: { label: "Open checklist", href: d.href },
    },
    o,
  );
}

function staffDomainAlert(
  d: EmailData["staff.domain_alert"],
  o: RenderOptions,
): RenderedParts {
  const words = Object.prototype.hasOwnProperty.call(
    STAFF_ALERT_KIND_WORDS,
    d.kind,
  )
    ? STAFF_ALERT_KIND_WORDS[d.kind]
    : undefined;
  if (!words) throw new Error("staff.domain_alert needs a known kind");
  const subject = `[CDS] ${d.business} · ${words} · ${d.domain}`;
  const rows: [string, string][] = [
    ["Kind", words],
    ["Site", `${d.business} (${d.orgId})`],
    ["Domain", d.domain],
  ];
  if (d.moveCode) rows.push(["Move", d.moveCode]);
  if (d.step) rows.push(["Step", STAFF_STEP_WORDS[d.step]]);
  if (d.rule) rows.push(["Rule", GATE_RULE_NAMES[d.rule]]);
  if (d.count !== undefined) rows.push(["Records", NUM.format(d.count)]);
  const lead = `A domain event on ${d.business} needs CDS: ${words}.`;
  const { html, text } = layout({
    brand: o.brand,
    preheader: lead,
    bodyHtml: paragraph(escapeHtml(lead)) + factsTable(rows),
    bodyText: [lead, "", ...factsText(rows)].join("\n"),
    button: { label: "Open in the console", href: d.href },
    ...noReplyFooter(STAFF_WHY),
  });
  return { subject: headerValue(subject), preheader: lead, html, text };
}

type Renderers = {
  [K in keyof EmailData]: (d: EmailData[K], o: RenderOptions) => RenderedParts;
};

const RENDERERS: Renderers = {
  "quote.saved": quoteSaved,
  "quote.reminder": quoteReminder,
  "email.confirm": emailConfirm,
  "fit.approved": fitApproved,
  "fit.declined": fitDeclined,
  "form.submission": formSubmission,
  "form.auto_reply": formAutoReply,
  "form.resume_link": formResumeLink,
  "media.alert": mediaAlert,
  "site.assembled": siteAssembled,
  "site.assembly_failed": siteAssemblyFailed,
  "agreement.signed": agreementSigned,
  "billing.receipt": billingReceipt,
  "billing.card_failed": billingCardFailed,
  "billing.lapsed": billingLapsed,
  "billing.restored": billingRestored,
  "billing.quote_sent": billingQuoteSent,
  "billing.stripe_setup": billingStripeSetup,
  "org.declined": orgDeclined,
  "billing.staff_alert": billingStaffAlert,
  "alert.notify": alertNotify,
  "alerts.digest": alertsDigest,
  "reports.monthly": reportsMonthly,
  "data_export.ready": dataExportReady,
  "booking.notice": bookingNotice,
  "member.invite": memberInvite,
  "support.notify": supportNotify,
  "support.sla_risk": supportSlaRisk,
  "staff.health_alert": staffHealthAlert,
  "support.rating_down": supportRatingDown,
  "scan.budget_cap": scanBudgetCap,
  "site.suspension_notice": siteSuspensionNotice,
  "site.suspended": siteSuspended,
  "site.suspension_lifted": siteSuspensionLifted,
  "report.content_notice": reportContentNotice,
  "report.received": reportReceived,
  "domain.records_copied": domainRecordsCopied,
  "domain.nameserver_steps": domainNameserverSteps,
  "domain.connected": domainConnected,
  "domain.switch_back": domainSwitchBack,
  "domain.lost_delegation": domainLostDelegation,
  "domain.expiry": domainExpiry,
  "review.sent": reviewSent,
  "offboarding.started": offboardingStarted,
  "offboarding.handed_back": offboardingHandedBack,
  "offboarding.handback_overdue": offboardingHandbackOverdue,
  "staff.domain_alert": staffDomainAlert,
  "hub.inquiry": hubInquiry,
};

export function hasTemplate(type: string): type is keyof EmailData {
  return Object.prototype.hasOwnProperty.call(RENDERERS, type);
}

export function renderEmail<T extends keyof EmailData>(
  type: T,
  data: EmailData[T],
  opts: RenderOptions = {},
): RenderedParts {
  if (!hasTemplate(type)) throw new Error(`no template for ${String(type)}`);
  return (
    RENDERERS[type] as (d: EmailData[T], o: RenderOptions) => RenderedParts
  )(data, opts);
}
