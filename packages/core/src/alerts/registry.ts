// Alert type registry (DASH-35, DASH-36, D313, D285). Core P11 types live here; add-ons add
// theirs through manifest `alerts` (11-08) and composeAlertTypes merges them.
import { InvalidInput } from "../errors";
import { can, type AuthSubject } from "../permissions";
import type {
  AlertChannelPrefs,
  AlertSource,
  AlertTypeSpec,
  ResolvedChannels,
} from "./types";

const ON = { email: true, push: true } as const;
const DIGEST = { email: true, push: false } as const;

function freezeSpec(s: AlertTypeSpec): AlertTypeSpec {
  return Object.freeze({
    ...s,
    defaultChannels: Object.freeze({
      email: s.defaultChannels.email,
      // D313: summary types never push.
      push: s.level === "summary" ? false : s.defaultChannels.push,
    }),
  });
}

/** P11 core alert types (D313 defaults). */
export const CORE_ALERT_TYPES: readonly AlertTypeSpec[] = Object.freeze(
  (
    [
      {
        type: "form.message",
        level: "normal",
        label: "New form message",
        example: "A message from your website's contact form",
        feature: "contacts",
        access: "read",
        section: "inbox",
        defaultChannels: ON,
      },
      {
        type: "billing.card_failed",
        level: "urgent",
        label: "Payment to CDS failed",
        example: "Your card on file was declined",
        feature: "billing",
        access: "read",
        ownerOnly: true,
        section: "settings",
        defaultChannels: ON,
      },
      {
        type: "payments.payouts_paused",
        level: "urgent",
        label: "Payouts paused",
        example: "Stripe paused payouts or needs information",
        feature: "connect",
        access: "read",
        // 11-24: Owner only. Its Needs-you item (billing:finish_stripe) and the fix (Connect
        // changes, D285) are the Owner's, so an Admin's copy would read as done at once.
        ownerOnly: true,
        section: "settings",
        defaultChannels: ON,
      },
      {
        type: "site.stage",
        level: "normal",
        label: "Your site's progress",
        example: "Your site is ready for your review, or your site is live",
        feature: "content",
        access: "read",
        section: "today",
        defaultChannels: ON,
      },
      {
        type: "data_export.ready",
        level: "normal",
        label: "Your data download is ready",
        example: "The download you asked for can be saved",
        feature: "exports",
        access: "run",
        ownerOnly: true,
        section: "settings",
        // The dedicated data_export.ready email with the signed link is sent by 11-40;
        // a generic alert email would duplicate it.
        defaultChannels: { email: false, push: true },
      },
      {
        type: "contact.new",
        level: "summary",
        label: "New contacts and subscribers",
        example: "People who joined your list yesterday",
        feature: "contacts",
        access: "read",
        section: "inbox",
        defaultChannels: DIGEST,
      },
      {
        type: "cds.notice",
        level: "urgent",
        label: "Service notice from CDS",
        example: "Something affecting your whole site",
        feature: "content",
        access: "read",
        section: "today",
        defaultChannels: ON,
      },
      {
        type: "reports.monthly",
        level: "summary",
        label: "Your site this month",
        example: "A monthly email with your visits and results",
        // 11-24: everyone who can open Reports (content:read), so Viewers get their one
        // Summary type (UI-SPEC Profile: "Viewers see only Summary types").
        feature: "content",
        access: "read",
        section: "reports",
        // Sent by the monthly job, never in the digest; the email switch is the opt-out.
        digest: false,
        defaultChannels: DIGEST,
      },
      // P12 (12-01; COMM-10): Support types. Normal level, so Viewers never get them (D313).
      {
        type: "support.reply",
        level: "normal",
        label: "CDS replies to your tickets",
        example: "A new reply from CDS on one of your tickets",
        feature: "support",
        access: "read",
        section: "support",
        defaultChannels: ON,
      },
      {
        type: "support.status",
        level: "normal",
        label: "Ticket status changes",
        example: "A ticket was resolved, closed or reopened",
        feature: "support",
        access: "read",
        section: "support",
        defaultChannels: ON,
      },
      {
        type: "cds.message",
        level: "normal",
        label: "Messages from CDS",
        example: "CDS started a conversation with you",
        feature: "support",
        access: "read",
        section: "support",
        defaultChannels: ON,
      },
      {
        type: "cds.note",
        level: "normal",
        label: "Notes from CDS",
        example: "CDS added a note for your site",
        feature: "support",
        access: "read",
        section: "support",
        defaultChannels: ON,
      },
      {
        type: "cds.document",
        level: "normal",
        label: "Documents from CDS",
        example: "CDS shared a document with you",
        feature: "support",
        access: "read",
        section: "support",
        defaultChannels: ON,
      },
      // 12-REVIEW CR-A01: its own type and key (`cds:idea:<id>`), a plain alert, so it never
      // replaces an unread CDS message and is never born cleared.
      {
        type: "cds.idea_built",
        level: "normal",
        label: "Ideas you voted for",
        example: "An idea your site voted for is built",
        feature: "support",
        access: "read",
        section: "support",
        defaultChannels: ON,
      },
      // P13 (13-02; P13-P17, STAFF-22): a notice to fix before suspension. Urgent, Owners and
      // Admins (settings:read), opens Settings. Staff mail (rating down, health) has no row.
      {
        type: "site.suspension_notice",
        level: "urgent",
        label: "Hosting rule notices",
        example:
          "CDS found something on your site that breaks the hosting rules",
        feature: "settings",
        access: "read",
        section: "settings",
        defaultChannels: ON,
      },
      // P14 (14-03 choice 3): Domain and Leaving CDS. Owners and Admins (domain:read /
      // offboarding:read), all open Settings. domain.expiry is urgent; the 30-day reminder is
      // raised as normal through the alert's data (the type's level is its worst case).
      {
        type: "domain.your_turn",
        level: "normal",
        label: "Your turn on your domain",
        example: "A step to connect your domain is waiting on you",
        feature: "domain",
        access: "read",
        section: "settings",
        defaultChannels: ON,
      },
      {
        type: "domain.connected",
        level: "normal",
        label: "Domain connected",
        example: "Your nameservers changed and your email records match",
        feature: "domain",
        access: "read",
        section: "settings",
        defaultChannels: ON,
      },
      {
        type: "domain.switch_back",
        level: "urgent",
        label: "Switch your nameservers back",
        example: "An email record didn't match after the switch",
        feature: "domain",
        access: "read",
        section: "settings",
        defaultChannels: ON,
      },
      {
        type: "domain.lost_delegation",
        level: "urgent",
        label: "Domain no longer points to CDS",
        example: "Your nameservers were changed; your site and email may stop",
        feature: "domain",
        access: "read",
        section: "settings",
        defaultChannels: ON,
      },
      {
        type: "domain.expiry",
        level: "urgent",
        label: "Domain renewal",
        example: "Your domain expires soon; renew it at your registrar",
        feature: "domain",
        access: "read",
        section: "settings",
        defaultChannels: ON,
      },
      {
        type: "offboarding.started",
        level: "normal",
        label: "Leaving CDS",
        example: "Your 30-day notice has started",
        feature: "offboarding",
        access: "read",
        section: "settings",
        defaultChannels: ON,
      },
      {
        type: "offboarding.handed_back",
        level: "normal",
        label: "DNS handed back",
        example: "Your DNS is back with you",
        feature: "offboarding",
        access: "read",
        section: "settings",
        defaultChannels: ON,
      },
    ] satisfies AlertTypeSpec[]
  ).map(freezeSpec),
);

/** Core types followed by every manifest's `alerts`. A duplicate `type` throws. */
export function composeAlertTypes(
  manifests: readonly AlertSource[],
): readonly AlertTypeSpec[] {
  const seen = new Map<string, string>();
  const out: AlertTypeSpec[] = [];
  const add = (s: AlertTypeSpec, owner: string) => {
    const prior = seen.get(s.type);
    if (prior !== undefined) {
      throw new InvalidInput(
        `alert type ${s.type} from ${owner} is already defined by ${prior}`,
      );
    }
    seen.set(s.type, owner);
    out.push(freezeSpec(s));
  };
  for (const s of CORE_ALERT_TYPES) add(s, "core");
  for (const m of manifests) for (const s of m.alerts ?? []) add(s, m.slug);
  return Object.freeze(out);
}

/** Channels for one person: defaults plus their overrides. Bell always; summary never pushes. */
export function channelsFor(
  spec: AlertTypeSpec,
  prefs?: AlertChannelPrefs,
): ResolvedChannels {
  const o = prefs?.[spec.type];
  const pick = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    bell: true,
    email: pick(o?.email, spec.defaultChannels.email),
    push:
      spec.level === "summary"
        ? false
        : pick(o?.push, spec.defaultChannels.push),
  };
}

/** True when the person's role and grants cover the alert (D285, T-11-05-01). */
export function eligibleFor(
  subject: AuthSubject,
  spec: AlertTypeSpec,
): boolean {
  if (spec.ownerOnly && subject.role !== "owner") return false;
  // 11-24 (UI-SPEC Profile): Viewers only ever get Summary types.
  if (subject.role === "viewer" && spec.level !== "summary") return false;
  return can(subject, spec.feature, spec.access);
}
