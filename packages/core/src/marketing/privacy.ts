// Owner: 15-18 (P15-P1). HUB_PRIVACY: the DRAFT privacy notice for the CDS hub site only
// (P15-P13). Not a POLICY_KEY: the five signed policies stay as they are (policies.test.ts
// asserts isPolicyKey("privacy") === false). Rendered on /privacy with renderLegalMarkdown, so
// the text must stay inside its subset: `## ` headings, paragraphs, `- ` lists, **bold** and
// https/mailto links. Every statement is a fact of the shipped code (T-15-18-02):
// - contact form fields: hub_inquiries (P15-P14); staff copy is the `hub.inquiry` email
// - 2 years: @cds/db HUB_INQUIRY_RETENTION_DAYS = 730, deleted by the daily retention job (15-07)
// - connection count: the 5-per-hour contact limit is the in-memory contactLimiter keyed on
//   ipBucket(ip) (@cds/db rate-limit), held for one hour; hub_inquiries stores no IP and no
//   value derived from it (migration 1790000901, WR-B06)
// - Turnstile: Cloudflare bot check on /contact and /report (P13)
// - no analytics or advertising cookies on the hub: GA4 is per tenant site only (STAFF-17)
// - report form: review case, never a tenant ticket (D249, D292)
// A lawyer reviews it before launch (15-29 GO-LIVE); `draft` stays true until then.

export type HubPrivacyNotice = {
  readonly draft: boolean;
  /** YYYY-MM-DD; shown as "Last updated <date>". */
  readonly updated: string;
  readonly markdown: string;
};

const MARKDOWN = [
  "This notice covers the Connections Design Studios website at connectionsdesignstudios.com: the pages that describe CDS, the contact form and the report form. Sites we host for our customers have their own privacy pages.",
  "## What we collect on the contact form",
  "When you send the contact form, we keep:",
  // One list: items joined by single newlines (a blank line would start a new <ul>).
  [
    "- your name",
    "- your email address",
    "- your business name, if you give it",
    "- what your message is about (a question, a call or press and partnership)",
    "- your phone number, if you ask for a call",
    "- your message",
  ].join("\n"),
  "## Why we keep it",
  "We use it to reply to you. We don't add you to a mailing list, and we don't sell or share it.",
  "## Where it is kept",
  "Your message is stored in the CDS platform database. A copy goes to the CDS team's inbox so a person can reply.",
  "## How long we keep it",
  "We delete contact form messages **2 years** after you send them.",
  "## Stopping abuse",
  "To limit how many messages one connection can send, our server counts the messages from your internet address for one hour, in its memory only. Your address is not saved with your message or anywhere else by the contact form. The contact form and the report form also use Cloudflare Turnstile, a check that you're a person and not a bot.",
  "## Cookies",
  "This website uses no analytics or advertising cookies.",
  "## The report form",
  "When you report content on a site we host, we keep what you tell us (the site, the page address, what's wrong, your name and email, and, for a copyright notice, your original work and signature) so a person at CDS can review the report. We may tell the site owner what was reported.",
  "## Your choices",
  "You can ask us to see, correct or delete what we hold about you. Email [hello@connectionsdesignstudios.com](mailto:hello@connectionsdesignstudios.com) and we'll reply by email.",
  "## Contact",
  "Questions about this notice: [hello@connectionsdesignstudios.com](mailto:hello@connectionsdesignstudios.com).",
].join("\n\n");

export const HUB_PRIVACY: HubPrivacyNotice = Object.freeze({
  draft: true,
  updated: "2026-10-18",
  markdown: MARKDOWN,
});
