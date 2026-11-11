// P13 emails (13-02; P13-P17, UI-SPEC Emails lines 990-1001; T-13-02-02).
import { EMAIL_TYPES } from "@cds/core/email";
import { P13_COPY } from "@cds/core/staff";
import { describe, expect, it } from "vitest";
import { ctWeekdayDate, renderEmail, type EmailData } from "./render/templates";

const CONSOLE = "https://cds.needtobeedgy.com/staff";
const HUB = "https://cds.needtobeedgy.com/hub";
const REPORTER_NAME = "Quinn Reporter";
const REPORTER_EMAIL = "quinn.reporter@example.com";
const OWNER_EMAIL = "owner@riverabakery.example";

const FIXTURES: { [K in P13Type]: EmailData[K] } = {
  "staff.health_alert": {
    state: "open",
    level: "critical",
    component: "PocketBase latency",
    reading: "2.4 s",
    threshold: "Critical above 2 s",
    since: new Date("2026-10-13T15:00:00Z"),
    href: `${CONSOLE}/health`,
  },
  "support.rating_down": {
    ticketNumber: 1042,
    business: "Rivera Bakery",
    agent: "Mara",
    subject: "Menu page photo is blurry",
    comment: null,
    resolvedAt: new Date("2026-10-12T15:00:00Z"),
    href: `${CONSOLE}/tickets/1042`,
  },
  "scan.budget_cap": { month: "2026-10", cap: 100000, used: 100000 },
  "site.suspension_notice": {
    business: "Rivera Bakery",
    fixBy: new Date("2026-10-16T17:00:00Z"),
    whatToFix: "Remove the copied photos on the Gallery page.",
    href: `${HUB}/settings`,
  },
  "site.suspended": {
    business: "Rivera Bakery",
    suspendedAt: new Date("2026-10-16T17:00:00Z"),
    reasonLabel: "Hosting rules",
    href: `${HUB}/support`,
  },
  "site.suspension_lifted": { business: "Rivera Bakery", href: HUB },
  "report.content_notice": {
    business: "Rivera Bakery",
    url: "https://riverabakery.example/gallery",
    categoryLabel: "Copyright",
    href: HUB,
  },
  "report.received": {
    caseCode: "R-32",
    url: "https://riverabakery.example/gallery",
    categoryLabel: "Copyright",
  },
};

type P13Type =
  | "staff.health_alert"
  | "support.rating_down"
  | "scan.budget_cap"
  | "site.suspension_notice"
  | "site.suspended"
  | "site.suspension_lifted"
  | "report.content_notice"
  | "report.received";

const TYPES = Object.keys(FIXTURES) as P13Type[];

function render<K extends P13Type>(type: K, data?: EmailData[K]) {
  const fixtures: Pick<EmailData, P13Type> = FIXTURES;
  return renderEmail(type, data ?? (fixtures[type] as EmailData[K]));
}

function buttons(html: string): number {
  return (html.match(/min-height:44px/g) ?? []).length;
}

describe("P13 email types (registry)", () => {
  it.each(TYPES)("%s is a transactional core type sent by the app", (t) => {
    const spec: { class: string; owner: string; sentBy?: string } =
      EMAIL_TYPES[t];
    expect(spec.class).toBe("transactional");
    expect(spec.owner).toBe("core");
    expect(spec.sentBy).toBeUndefined();
  });
});

describe("P13 templates", () => {
  it.each(TYPES)(
    "%s renders subject, text and html with one button max",
    (t) => {
      const m = render(t);
      expect(m.subject.length).toBeGreaterThan(0);
      expect(m.text.length).toBeGreaterThan(0);
      expect(m.html).toContain("<!doctype html>");
      expect(buttons(m.html)).toBeLessThanOrEqual(1);
    },
  );

  it("health alert open and close subjects", () => {
    expect(render("staff.health_alert").subject).toBe(
      "Critical: PocketBase latency 2.4 s",
    );
    const closed = render("staff.health_alert", {
      ...FIXTURES["staff.health_alert"],
      state: "close",
    });
    expect(closed.subject).toBe("Resolved: PocketBase latency");
    expect(closed.text).toContain("Open Health");
  });

  it("rating down: subject, No comment, console button", () => {
    const m = render("support.rating_down");
    expect(m.subject).toBe("Thumbs down on #1042 · Rivera Bakery");
    expect(m.text).toContain(P13_COPY.MAIL_NO_COMMENT);
    expect(m.text).toContain("Open ticket #1042");
    expect(m.text).toContain("Mara");
    const withComment = render("support.rating_down", {
      ...FIXTURES["support.rating_down"],
      comment: "Took <b>three</b> tries.",
    });
    expect(withComment.html).toContain("&lt;b&gt;three&lt;/b&gt;");
    expect(withComment.text).not.toContain(P13_COPY.MAIL_NO_COMMENT);
  });

  it("budget cap has no button", () => {
    expect(buttons(render("scan.budget_cap").html)).toBe(0);
  });

  it("suspension notice: subject with the Chicago date, SUSP-NOTICE and the mistake line", () => {
    const m = render("site.suspension_notice");
    expect(ctWeekdayDate(new Date("2026-10-16T17:00:00Z"))).toBe("Fri 16 Oct");
    expect(m.subject).toBe("Action needed on Rivera Bakery by Fri 16 Oct");
    expect(m.text).toContain(
      "CDS found something on your site that breaks the hosting rules. Fix it by Fri 16 Oct or your site goes offline.",
    );
    expect(m.text).toContain("Remove the copied photos on the Gallery page.");
    expect(m.text).toContain(P13_COPY.MAIL_MISTAKE_LINE);
    expect(m.text).toContain("See what to fix");
  });

  it("suspended and lifted subjects and buttons", () => {
    const s = render("site.suspended");
    expect(s.subject).toBe("Rivera Bakery is offline");
    expect(s.text).toContain(
      "Your site is offline. CDS suspended it on 16 Oct.",
    );
    expect(s.text).toContain("Open CDS Support");
    const l = render("site.suspension_lifted");
    expect(l.subject).toBe("Rivera Bakery is back online");
    expect(l.text).toContain(P13_COPY.MAIL_BACK_ONLINE);
    expect(l.text).toContain("Open your hub");
  });

  it("report.received: R- number, no button, no outcome promise", () => {
    const m = render("report.received");
    expect(m.subject).toBe("We received your report R-32");
    expect(buttons(m.html)).toBe(0);
    expect(m.text).toContain(P13_COPY.MAIL_REPORT_REVIEW);
    expect(() =>
      render("report.received", {
        ...FIXTURES["report.received"],
        caseCode: "nope",
      }),
    ).toThrow();
  });
});

describe("report mail never crosses contact data (D249, T-13-02-02)", () => {
  it("report.content_notice carries no reporter name or email", () => {
    // Even a caller that smuggles extra fields cannot leak them: the shape has no slot.
    const smuggled = {
      ...FIXTURES["report.content_notice"],
      reporterName: REPORTER_NAME,
      reporterEmail: REPORTER_EMAIL,
    } as EmailData["report.content_notice"];
    const m = render("report.content_notice", smuggled);
    for (const part of [m.subject, m.text, m.html, m.preheader]) {
      expect(part).not.toContain(REPORTER_NAME);
      expect(part).not.toContain(REPORTER_EMAIL);
    }
    expect(m.text).toContain("https://riverabakery.example/gallery");
    expect(m.text).toContain("Copyright");
  });

  it("report.received carries no owner email", () => {
    const smuggled = {
      ...FIXTURES["report.received"],
      ownerEmail: OWNER_EMAIL,
    } as EmailData["report.received"];
    const m = render("report.received", smuggled);
    for (const part of [m.subject, m.text, m.html, m.preheader]) {
      expect(part).not.toContain(OWNER_EMAIL);
    }
  });
});

describe("support.status rating links (STAFF-21; UI-SPEC line 1000)", () => {
  const resolved: EmailData["support.notify"] = {
    kind: "support.status",
    business: "Rivera Bakery",
    ticket: { number: 1042, subject: "Menu", status: "resolved" },
    href: `${HUB}/support/tickets/1042`,
    ratingLinks: {
      up: `${HUB}/support/tickets/1042/rate?r=up&t=abc`,
      down: `${HUB}/support/tickets/1042/rate?r=down&t=abc`,
    },
  };

  it("adds RATING-Q with Yes / No text links and keeps one button", () => {
    const m = renderEmail("support.notify", resolved);
    expect(m.text).toContain(P13_COPY.RATING_Q);
    expect(m.text).toContain(`Yes: ${resolved.ratingLinks!.up}`);
    expect(m.text).toContain(`No: ${resolved.ratingLinks!.down}`);
    expect(m.html).toContain("r=down&amp;t=abc");
    expect(buttons(m.html)).toBe(1);
    expect(m.text).toContain("Open the ticket");
  });

  it("is left out for other statuses and without links", () => {
    const waiting = renderEmail("support.notify", {
      ...resolved,
      ticket: { number: 1042, subject: "Menu", status: "waiting_on_you" },
    });
    expect(waiting.text).not.toContain(P13_COPY.RATING_Q);
    const noLinks = { ...resolved, ratingLinks: undefined };
    expect(renderEmail("support.notify", noLinks).text).not.toContain(
      P13_COPY.RATING_Q,
    );
  });

  it("refuses a non-http rating link", () => {
    expect(() =>
      renderEmail("support.notify", {
        ...resolved,
        ratingLinks: {
          up: "javascript:alert(1)",
          down: resolved.ratingLinks!.down,
        },
      }),
    ).toThrow();
  });
});
