// P14 emails (14-03 choices 2 and 5; 14-UI-SPEC "Emails"; T-14-03-02, T-14-03-03).
import { EMAIL_TYPES } from "@cds/core/email";
import { describe, expect, it } from "vitest";
import { longDate, renderEmail, type EmailData } from "./templates";

const HUB = "https://cds.needtobeedgy.com/hub";
const CONSOLE = "https://cds.needtobeedgy.com/staff";
const at = { domain: "riverabakery.com", registrar: "GoDaddy" };

type P14Type =
  | "domain.records_copied"
  | "domain.nameserver_steps"
  | "domain.connected"
  | "domain.switch_back"
  | "domain.lost_delegation"
  | "domain.expiry"
  | "review.sent"
  | "offboarding.started"
  | "offboarding.handed_back"
  | "offboarding.handback_overdue"
  | "staff.domain_alert";

const FIXTURES: { [K in P14Type]: EmailData[K] } = {
  "domain.records_copied": { ...at, href: `${HUB}/settings/domain` },
  "domain.nameserver_steps": {
    sender: "Maria",
    business: "Rivera Bakery",
    ...at,
    nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
    steps: [
      "Sign in to GoDaddy and open My Products.",
      "Choose riverabakery.com, then DNS, then Nameservers.",
    ],
    note: "Thanks Tom, this is for the new website.",
  },
  "domain.connected": { domain: at.domain, href: `${HUB}/settings/domain` },
  "domain.switch_back": { ...at, count: 1, href: `${HUB}/settings/domain` },
  "domain.lost_delegation": { ...at, href: `${HUB}/settings/domain` },
  "domain.expiry": {
    ...at,
    days: 30,
    expiresOn: new Date("2027-03-03T00:00:00Z"),
    href: `${HUB}/settings/domain`,
  },
  "review.sent": {},
  "offboarding.started": {
    endsOn: new Date("2026-11-14T12:00:00Z"),
    href: `${HUB}/settings/leaving`,
  },
  "offboarding.handed_back": {},
  "offboarding.handback_overdue": { href: `${HUB}/settings/leaving` },
  "staff.domain_alert": {
    kind: "post_switch_mismatch",
    business: "Rivera Bakery",
    orgId: "abc123def456ghi",
    domain: at.domain,
    moveCode: "M-14",
    step: "delegation",
    count: 1,
    href: `${CONSOLE}/sites/abc123def456ghi?tab=domain`,
  },
};

const TYPES = Object.keys(FIXTURES) as P14Type[];

function render<K extends P14Type>(type: K, data?: EmailData[K]) {
  const fixtures: Pick<EmailData, P14Type> = FIXTURES;
  return renderEmail(type, data ?? (fixtures[type] as EmailData[K]));
}

function buttons(html: string): number {
  return (html.match(/min-height:44px/g) ?? []).length;
}

describe("P14 email types (registry)", () => {
  it.each(TYPES)("%s is a transactional core type sent by the app", (t) => {
    const spec: { class: string; owner: string; sentBy?: string } =
      EMAIL_TYPES[t];
    expect(spec.class).toBe("transactional");
    expect(spec.owner).toBe("core");
    expect(spec.sentBy).toBeUndefined();
  });
});

describe("P14 templates", () => {
  it.each(TYPES)("%s renders with one button max", (t) => {
    const m = render(t);
    expect(m.subject.length).toBeGreaterThan(0);
    expect(m.text.length).toBeGreaterThan(0);
    expect(m.html).toContain("<!doctype html>");
    expect(buttons(m.html)).toBeLessThanOrEqual(1);
  });

  it("subjects and first lines are the UI-SPEC copy", () => {
    const cases: [P14Type, string, string][] = [
      [
        "domain.records_copied",
        "Next step for riverabakery.com",
        "Every record on riverabakery.com is copied, email included. Next: change your nameservers at GoDaddy.",
      ],
      [
        "domain.nameserver_steps",
        "Nameserver steps for riverabakery.com",
        "Maria at Rivera Bakery asked you to change the nameservers for riverabakery.com.",
      ],
      [
        "domain.connected",
        "riverabakery.com is connected",
        "Your nameservers changed and your email records match. Your site goes live at riverabakery.com when Support approves your launch.",
      ],
      [
        "domain.switch_back",
        "Action needed: switch riverabakery.com's nameservers back",
        "After the switch, 1 email record didn't match the copy. Your email keeps working at GoDaddy, because Support never changed anything there. Change your nameservers back now. Support has been alerted and will contact you today.",
      ],
      [
        "domain.lost_delegation",
        "riverabakery.com no longer points to us",
        "The nameservers at GoDaddy were changed. Your site and email may stop working. Change them back to these two, or ask Support.",
      ],
      [
        "domain.expiry",
        "Renew riverabakery.com by 3 Mar",
        "Renew riverabakery.com at GoDaddy before 3 Mar, or your site and email stop.",
      ],
      [
        "review.sent",
        "Support is giving your site a final look",
        "Usually within 1 business day. We'll email you the moment you're live. You can still edit, but changed pages need another look.",
      ],
      [
        "offboarding.started",
        "Your 30-day notice has started",
        "Your site stays up until 14 Nov 2026. First, move your DNS so your email keeps working.",
      ],
      [
        "offboarding.handed_back",
        "Your DNS is back with you",
        "Your DNS is back with you. Your email keeps working.",
      ],
      [
        "offboarding.handback_overdue",
        "Your DNS is still with us",
        "Your notice has ended, but your DNS is still with us. Move it so we can close your site.",
      ],
    ];
    for (const [t, subject, first] of cases) {
      const m = render(t);
      expect(m.subject, t).toBe(subject);
      expect(m.preheader, t).toBe(first);
      expect(m.text, t).toContain(first);
    }
  });

  it("buttons: the UI-SPEC labels; review sent and handed back have none", () => {
    expect(render("domain.records_copied").text).toContain("See the steps");
    expect(render("domain.connected").text).toContain("Open Domain settings");
    expect(render("domain.switch_back").text).toContain("See what to do");
    expect(render("domain.expiry").text).toContain("How to renew");
    expect(render("offboarding.started").text).toContain("Open checklist");
    expect(render("offboarding.handback_overdue").text).toContain(
      "Open checklist",
    );
    expect(buttons(render("review.sent").html)).toBe(0);
    expect(buttons(render("offboarding.handed_back").html)).toBe(0);
  });

  it("expiry at 7 days uses EXPIRY-7", () => {
    const m = render("domain.expiry", {
      ...FIXTURES["domain.expiry"],
      days: 7,
    });
    expect(m.text).toContain(
      "Renew riverabakery.com at GoDaddy, or your site and email stop on 3 Mar.",
    );
    expect(longDate(new Date("2026-11-14T12:00:00Z"))).toBe("14 Nov 2026");
  });

  it("nameserver steps: both nameservers in plain text, no button, no hub link (T-14-03-03)", () => {
    const m = render("domain.nameserver_steps");
    expect(m.text).toContain("ada.ns.cloudflare.com");
    expect(m.text).toContain("bob.ns.cloudflare.com");
    expect(m.text).toContain("Steps at GoDaddy");
    expect(m.text).toContain("1. Sign in to GoDaddy and open My Products.");
    expect(m.text).toContain("Note from Maria: Thanks Tom");
    expect(buttons(m.html)).toBe(0);
    expect(m.text).not.toContain("/hub");
    expect(m.html).not.toContain("/hub");
  });

  it("nameserver steps: the note is escaped and capped; bad nameservers throw", () => {
    const m = render("domain.nameserver_steps", {
      ...FIXTURES["domain.nameserver_steps"],
      note: `<a href="x">${"y".repeat(800)}</a>`,
    });
    expect(m.html).not.toContain('<a href="x">');
    expect(m.text).not.toContain("y".repeat(501));
    expect(() =>
      render("domain.nameserver_steps", {
        ...FIXTURES["domain.nameserver_steps"],
        nameservers: ["ada.ns.cloudflare.com", "<script>"],
      }),
    ).toThrow();
  });

  it("staff alert: subject shape, ids and counts only, console button (T-14-03-02)", () => {
    const m = render("staff.domain_alert");
    expect(m.subject).toBe(
      "[Alert] Rivera Bakery · post-switch mismatch · riverabakery.com",
    );
    expect(m.text).toContain("abc123def456ghi");
    expect(m.text).toContain("M-14");
    expect(m.text).toContain("5 Delegation verified");
    expect(m.text).toContain("Open in the console");
    expect(m.text).not.toMatch(/@/);
    expect(buttons(m.html)).toBe(1);
    const shape = Object.keys(FIXTURES["staff.domain_alert"]).sort();
    for (const k of shape) {
      expect(["value", "email", "owner", "records"]).not.toContain(k);
    }
  });

  it("staff alert: every kind has subject words; unknown kinds throw", () => {
    const kinds = [
      "post_switch_mismatch",
      "move_failed",
      "gate_override_needed",
      "handback_mismatch",
      "ns_slow",
      "expiry_7d",
      "delegation_lost",
      "launch_requested",
      "dnssec_unknown",
      "handback_overdue",
    ] as const;
    for (const kind of kinds) {
      const m = render("staff.domain_alert", {
        ...FIXTURES["staff.domain_alert"],
        kind,
      });
      expect(m.subject).toMatch(
        /^\[Alert\] Rivera Bakery · .+ · riverabakery\.com$/,
      );
    }
    expect(() =>
      render("staff.domain_alert", {
        ...FIXTURES["staff.domain_alert"],
        kind: "nope" as never,
      }),
    ).toThrow();
  });
});
