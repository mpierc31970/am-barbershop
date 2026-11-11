// The email class table (EMAIL-01, D267, RESEARCH Pattern 9). Every email the platform sends
// is a registered type with a class, so suppression rules always know what they are looking at.
// Add-ons contribute `<slug>.`-prefixed types through their manifest `emails`.
import type { AddonManifest } from "../addons/types";
import { InvalidInput } from "../errors";
import type { EmailTypeSpec } from "./types";

export const EMAIL_TYPES = {
  "quote.saved": {
    class: "transactional",
    owner: "core",
    description: "The quote a visitor saved at /start, with its link.",
  },
  "quote.reminder": {
    class: "marketing",
    owner: "core",
    description: "Day 1 and day 3 reminders for a saved, unsubmitted quote.",
  },
  "auth.code": {
    class: "transactional",
    owner: "core",
    sentBy: "pb",
    description: "The sign-in code (PocketBase OTP template).",
  },
  "email.confirm": {
    class: "transactional",
    owner: "core",
    description: "Confirm an email routing address for an organization.",
  },
  // PD-23: the fit:review CLI tells the owner the outcome.
  "fit.approved": {
    class: "transactional",
    owner: "core",
    description: "A held intake passed the fit review; the build continues.",
  },
  "fit.declined": {
    class: "transactional",
    owner: "core",
    description: "A held intake was declined in the fit review.",
  },
  // P7 (07-01): form messages (07-15) and staff media alerts (07-27).
  "form.submission": {
    class: "transactional",
    owner: "core",
    description:
      "A visitor sent a message through a form on the tenant's site; goes to the form's notify route (CONT-25, D231).",
  },
  // P10 (10-36): Forms Pro auto-reply.
  "form.auto_reply": {
    class: "transactional",
    owner: "core",
    description:
      "Forms Pro auto-reply to the person who submitted a form (BILL-14, D233). Sent as the tenant.",
  },
  // P10 (10-37): Forms Pro "save and finish later" resume link.
  "form.resume_link": {
    class: "transactional",
    owner: "core",
    description:
      "Forms Pro save-and-finish-later link to the visitor who saved a partly filled form (BILL-14, D233). Sent as the tenant.",
  },
  "media.alert": {
    class: "transactional",
    owner: "core",
    description:
      "Staff alert: media CDN fallback started or hit the 72 h cap, or a tenant is over its media allowance. Sent as CDS (sender kind cds) to staff (CONT-19/20, D221, D278).",
  },
  // P8 (08-10): the staff hand-off of an assembled site (no staff console until P13).
  "site.assembled": {
    class: "transactional",
    owner: "core",
    description:
      "Staff: a site assembled from intake, with the slot report (TMPL-04, CONTEXT A4-Q1). Sent as CDS to staff.",
  },
  "site.assembly_failed": {
    class: "transactional",
    owner: "core",
    description:
      "Staff: site assembly stopped after 3 tries (CONTEXT A2-Q4). Sent as CDS to staff.",
  },
  // P9 (09-13): the signer's record of a signing.
  "agreement.signed": {
    class: "transactional",
    owner: "core",
    description: "A signed agreement's record and download link (AGR-04).",
  },
  // P10 (10-03): billing messages. Owner words only ("paused", never "lapsed") in the copy.
  "billing.receipt": {
    class: "transactional",
    owner: "core",
    description: "Receipt for a CDS invoice paid, with its lines (BILL-08).",
  },
  "billing.card_failed": {
    class: "transactional",
    owner: "core",
    description:
      "A CDS card payment failed; add-ons still on, Stripe retrying (BILL-03, D310).",
  },
  "billing.lapsed": {
    class: "transactional",
    owner: "core",
    description:
      "Retries ran out; the owner's add-ons are paused, data kept (BILL-03, D310).",
  },
  "billing.restored": {
    class: "transactional",
    owner: "core",
    description:
      "Overdue bill paid; paused add-ons are back on (BILL-03, D310).",
  },
  "billing.quote_sent": {
    class: "transactional",
    owner: "core",
    description: "CDS sent the owner a work quote to review (BILL-20).",
  },
  "billing.stripe_setup": {
    class: "transactional",
    owner: "core",
    description:
      "The owner's Stripe account needs attention; online payments paused (PAY-03).",
  },
  "org.declined": {
    class: "transactional",
    owner: "core",
    description:
      "CDS declined the build, refunded in full, with the reason category (BILL-09, D214).",
  },
  "billing.staff_alert": {
    class: "transactional",
    owner: "core",
    description:
      "Staff: a billing or Stripe state change needs a look, once per change (CONTEXT A1). Sent as CDS to staff.",
  },
  // P11 (11-10): owner alerts, the morning summary, the monthly report, the data download and
  // team invites (UI-SPEC Emails; DASH-12, DASH-34, DASH-37, LIFE-04). All transactional.
  "alert.notify": {
    class: "transactional",
    owner: "core",
    description:
      "One owner alert by email (urgent or normal); the safe title only in sensitive-practice mode (DASH-34, DASH-37). Sent as the org.",
  },
  "alerts.digest": {
    class: "transactional",
    owner: "core",
    description:
      "The 7am morning summary of yesterday's alerts; never sent empty; counts only in sensitive-practice mode (DASH-34, DASH-37). Sent as the org.",
  },
  "reports.monthly": {
    class: "transactional",
    owner: "core",
    description:
      "The monthly Site Report email on the 1st, after launch (DASH-12). Sent as the org to owners.",
  },
  "data_export.ready": {
    class: "transactional",
    owner: "core",
    description:
      "The owner's data download is ready; the link works for 7 days (LIFE-04).",
  },
  "booking.notice": {
    class: "transactional",
    owner: "core",
    description:
      "Studio Booking: a client's booking confirmation, reminder or cancellation, sent as the shop.",
  },
  "member.invite": {
    class: "transactional",
    owner: "core",
    description:
      "An owner invited someone to help run the site, with the join link (7 days).",
  },
  // P12 (12-05): CDS Support mail, sent as "CDS Support" from a no-reply address (D97, COMM-10).
  "support.notify": {
    class: "transactional",
    owner: "core",
    description: "One support alert by email. Sent as CDS Support, no-reply.",
  },
  "support.sla_risk": {
    class: "transactional",
    owner: "core",
    description:
      "Staff: a ticket's first-reply target is at risk, with the support:show command. Sent as CDS Support, no-reply, to staff only.",
  },
  // P13 (13-02; P13-P17): staff mail goes to staffAlertAddress() as CDS, no-reply; owner mail
  // to Owners and Admins as CDS; the reporter mail as CDS.
  "staff.health_alert": {
    class: "transactional",
    owner: "core",
    description:
      "Staff: a health check opened or closed an incident (one email per incident). Sent as CDS, no-reply, to staff only.",
  },
  "support.rating_down": {
    class: "transactional",
    owner: "core",
    description:
      "Staff: an owner gave a resolved ticket a thumbs down, with the comment. Sent as CDS, no-reply, to staff only.",
  },
  "scan.budget_cap": {
    class: "transactional",
    owner: "core",
    description:
      "Staff: the monthly Web Risk link-check cap was reached (once a month). Sent as CDS, no-reply, to staff only.",
  },
  "site.suspension_notice": {
    class: "transactional",
    owner: "core",
    description:
      "Owners and Admins: CDS found something that breaks the hosting rules; fix it by the date or the site goes offline.",
  },
  "site.suspended": {
    class: "transactional",
    owner: "core",
    description:
      "Owners and Admins: the site is offline (suspended); the hub and CDS Support still work.",
  },
  "site.suspension_lifted": {
    class: "transactional",
    owner: "core",
    description:
      "Owners and Admins: the suspension was lifted; the site is back online.",
  },
  "report.content_notice": {
    class: "transactional",
    owner: "core",
    description:
      "Owners and Admins: someone reported a page on the site (URL and reason only, never the reporter).",
  },
  "report.received": {
    class: "transactional",
    owner: "core",
    description:
      "The reporter: CDS received the report, with its R- number. Sent as CDS; never names the site's owner.",
  },
  // P14 (14-03; 14-UI-SPEC "Emails"). Owner mail as CDS; domain.switch_back and
  // domain.lost_delegation go to Owners and Admins. The P11 "You're live" mail is reused.
  "domain.records_copied": {
    class: "transactional",
    owner: "core",
    description:
      "Owner: every record on the domain is copied; next, change the nameservers at the registrar.",
  },
  "domain.nameserver_steps": {
    class: "transactional",
    owner: "core",
    description:
      "A typed address (not a member): the two nameservers and the registrar steps, sent at the owner's request. No hub link.",
  },
  "domain.connected": {
    class: "transactional",
    owner: "core",
    description:
      "Owner: the nameservers changed and the email records match; goes live when CDS approves the launch.",
  },
  "domain.switch_back": {
    class: "transactional",
    owner: "core",
    description:
      "Owners and Admins (urgent): an email record didn't match after the switch; change the nameservers back now.",
  },
  "domain.lost_delegation": {
    class: "transactional",
    owner: "core",
    description:
      "Owners and Admins (urgent): the domain no longer points to CDS; site and email may stop.",
  },
  "domain.expiry": {
    class: "transactional",
    owner: "core",
    description:
      "Owner: the domain expires in 30 or 7 days; renew it at the registrar.",
  },
  "review.sent": {
    class: "transactional",
    owner: "core",
    description:
      "Owner: the launch review was sent; CDS is giving the site a final look.",
  },
  "offboarding.started": {
    class: "transactional",
    owner: "core",
    description:
      "Owner: the 30-day notice started; move the DNS first so email keeps working.",
  },
  "offboarding.handed_back": {
    class: "transactional",
    owner: "core",
    description: "Owner: the DNS is back with them; email keeps working.",
  },
  "offboarding.handback_overdue": {
    class: "transactional",
    owner: "core",
    description:
      "Owner: the notice ended but the DNS is still at CDS; move it so CDS can close the site (P14-P36). Repeated once after 7 days.",
  },
  "staff.domain_alert": {
    class: "transactional",
    owner: "core",
    description:
      "Staff: a domain move, gate, handback or health event needs CDS (ids, counts and kind only). Sent as CDS, no-reply, to staff only.",
  },
  // P15 (15-03; HUB-07, P15-P14). Staff only; the visitor's address is the Reply-To.
  "hub.inquiry": {
    class: "transactional",
    owner: "core",
    description: "A visitor sent the CDS hub contact form (staff copy).",
  },
} as const satisfies Record<string, EmailTypeSpec>;

export type CoreEmailType = keyof typeof EMAIL_TYPES;

export type EmailTypeRegistry = {
  get(type: string): EmailTypeSpec | undefined;
  list(): readonly [string, EmailTypeSpec][];
};

export function composeEmailTypes(
  addons: readonly AddonManifest[],
): EmailTypeRegistry {
  const table = new Map<string, EmailTypeSpec>(
    Object.entries(EMAIL_TYPES) as [string, EmailTypeSpec][],
  );
  for (const m of addons) {
    for (const e of m.emails ?? []) {
      if (!e.type.startsWith(`${m.slug}.`)) {
        throw new InvalidInput(
          `Add-on ${m.slug}: email type ${e.type} must start with "${m.slug}.".`,
        );
      }
      if (table.has(e.type)) {
        throw new InvalidInput(
          `Add-on ${m.slug}: email type ${e.type} is already registered.`,
        );
      }
      table.set(e.type, {
        class: e.class,
        owner: m.slug,
        description: e.description,
      });
    }
  }
  const entries = Object.freeze([...table.entries()]);
  return {
    get: (type) => (typeof type === "string" ? table.get(type) : undefined),
    list: () => entries,
  };
}

/** The send pipeline calls this first: an unregistered type never goes out (EMAIL-01). */
export function lookupEmailType(
  reg: EmailTypeRegistry,
  type: string,
): EmailTypeSpec {
  const spec = reg.get(type);
  if (!spec) throw new InvalidInput(`unregistered email type: ${String(type)}`);
  return spec;
}
