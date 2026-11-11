// P11 owner emails (11-10; UI-SPEC Emails; DASH-12, DASH-34, DASH-37, LIFE-04; T-11-10-01).
import { EMAIL_TYPES } from "@cds/core/email";
import { describe, expect, it } from "vitest";
import { hasTemplate, renderEmail, type EmailData } from "./render/templates";

const HUB = "https://cds.needtobeedgy.com/hub";
const SETTINGS = `${HUB}/profile#alerts`;

const alert = (
  over: Partial<EmailData["alert.notify"]> = {},
): EmailData["alert.notify"] => ({
  business: "Rivera Bakery",
  section: "Bookings",
  title: "Maria Lopez booked a deep tissue massage for Thursday",
  safeTitle: "New booking for Thursday",
  sensitive: false,
  actionLabel: "View booking",
  href: `${HUB}/bookings/b1`,
  sentAt: new Date("2026-10-07T19:14:00.000Z"),
  alertLabel: "new booking",
  settingsHref: SETTINGS,
  ...over,
});

describe("registry/template parity (EMAIL-01)", () => {
  it("every app-sent core type has a template", () => {
    for (const [type, spec] of Object.entries(EMAIL_TYPES)) {
      if ((spec as { sentBy?: string }).sentBy === "pb") continue;
      expect(hasTemplate(type), type).toBe(true);
    }
  });
});

describe("alert.notify (DASH-34, DASH-37)", () => {
  it("not sensitive: the full title is the subject and the body line", () => {
    const m = renderEmail("alert.notify", alert(), { brand: "Rivera Bakery" });
    expect(m.subject).toBe(
      "Maria Lopez booked a deep tissue massage for Thursday",
    );
    expect(m.preheader).toBe("Rivera Bakery · Bookings");
    expect(m.text).toContain("Maria Lopez");
    expect(m.text).toContain("Sent 7 Oct, 2:14 pm.");
    expect(m.html).toContain("View booking");
    expect(m.text).toContain(
      "You get this because new booking alerts are on. Change your alerts: https://cds.needtobeedgy.com/hub/profile#alerts",
    );
    expect(m.html).not.toContain("CDS logo");
  });

  it("sensitive: the full title appears nowhere (subject, preheader, html, text)", () => {
    const m = renderEmail("alert.notify", alert({ sensitive: true }));
    expect(m.subject).toBe("New booking for Thursday");
    for (const part of [m.subject, m.preheader, m.html, m.text]) {
      expect(part).not.toContain("Maria");
      expect(part).not.toContain("deep tissue");
    }
    expect(m.text).toContain("New booking for Thursday");
  });

  it("escapes the title; the subject is header-safe", () => {
    const m = renderEmail(
      "alert.notify",
      alert({ title: "<script>x</script>\r\nBcc: a@b.c" }),
    );
    expect(m.html).not.toContain("<script");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("refuses a non-http link", () => {
    expect(() =>
      renderEmail("alert.notify", alert({ href: "javascript:alert(1)" })),
    ).toThrow();
  });
});

describe("alerts.digest (DASH-34, DASH-37)", () => {
  const lines = [
    {
      text: "2 new contacts: Ana and Ben",
      safeText: "2 new contacts",
      count: 2,
    },
    { text: "1 post went live", safeText: "1 post went live", count: 1 },
  ];

  it("subject, preheader count, lines and the Open Today button", () => {
    const m = renderEmail("alerts.digest", {
      business: "Rivera Bakery",
      lines,
      href: `${HUB}/today`,
      settingsHref: SETTINGS,
    });
    expect(m.subject).toBe("Your morning summary for Rivera Bakery");
    expect(m.preheader).toBe("3 things from yesterday.");
    expect(m.text).toContain("2 new contacts: Ana and Ben");
    expect(m.html).toContain("Open Today");
  });

  it("sensitive: counts only, never client names", () => {
    const m = renderEmail("alerts.digest", {
      business: "Rivera Bakery",
      lines,
      sensitive: true,
      href: `${HUB}/today`,
      settingsHref: SETTINGS,
    });
    expect(m.text).toContain("2 new contacts");
    expect(m.text).not.toContain("Ana");
    expect(m.html).not.toContain("Ana");
  });

  it("sensitive without a safe line throws rather than leak the full line", () => {
    expect(() =>
      renderEmail("alerts.digest", {
        business: "Rivera Bakery",
        lines: [{ text: "Ana booked" }],
        sensitive: true,
        href: `${HUB}/today`,
        settingsHref: SETTINGS,
      }),
    ).toThrow();
  });

  it("an empty digest is not renderable (callers skip it)", () => {
    expect(() =>
      renderEmail("alerts.digest", {
        business: "Rivera Bakery",
        lines: [],
        href: `${HUB}/today`,
        settingsHref: SETTINGS,
      }),
    ).toThrow(/skip/);
  });
});

describe("reports.monthly (DASH-12)", () => {
  const data: EmailData["reports.monthly"] = {
    business: "Rivera Bakery",
    month: "October",
    visitors: 1284,
    messages: 23,
    lines: [
      "Visitors: 1,284 (up 12% on last month)",
      "Top page: Menu",
      "Top source: Google",
      "Messages: 23",
      "Speed: your site got faster",
    ],
    tip: "Add a photo to your Menu page.",
    href: `${HUB}/reports`,
  };

  it("subject, preheader, five lines, tip and footer", () => {
    const m = renderEmail("reports.monthly", data);
    expect(m.subject).toBe("Your site this month: October");
    expect(m.preheader).toBe("1,284 visitors and 23 messages.");
    expect(m.text).toContain("Top source: Google");
    expect(m.text).toContain("One tip: Add a photo to your Menu page.");
    expect(m.text).not.toContain("page..");
    expect(m.html).toContain("See your Site Report");
    expect(m.text).toContain(
      "Sent to your team on the 1st of each month. Turn it off in your profile.",
    );
  });

  it("needs exactly five lines", () => {
    expect(() =>
      renderEmail("reports.monthly", {
        ...data,
        lines: data.lines.slice(0, 4),
      }),
    ).toThrow();
  });
});

describe("data_export.ready (LIFE-04)", () => {
  it("UI-SPEC copy and the Download your data button", () => {
    const m = renderEmail("data_export.ready", {
      business: "Rivera Bakery",
      href: "https://cds.needtobeedgy.com/hub/settings/data/d/tok",
      expiresOn: "16 Oct",
    });
    expect(m.subject).toBe("Your data download is ready");
    expect(m.preheader).toBe("The link works for 7 days.");
    expect(m.text).toContain(
      "Your download of Rivera Bakery's data is ready: a spreadsheet for each kind of record and a zip of your media. The link works until 16 Oct.",
    );
    expect(m.html).toContain("Download your data");
  });
});

describe("member.invite", () => {
  it("UI-SPEC copy with the right article", () => {
    const m = renderEmail("member.invite", {
      business: "Rivera Bakery",
      inviterName: "Maria",
      role: "Editor",
      href: "https://cds.needtobeedgy.com/invite/tok",
      expiresOn: "18 Oct",
    });
    expect(m.subject).toBe(
      "Maria invited you to help with Rivera Bakery's website",
    );
    expect(m.preheader).toBe("Join as an Editor.");
    expect(m.text).toContain(
      "Maria invited you to help run Rivera Bakery's website as an Editor. The invite works for 7 days.",
    );
    expect(m.html).toContain("Join Rivera Bakery");
    const v = renderEmail("member.invite", {
      business: "Rivera Bakery",
      inviterName: "Maria",
      role: "Viewer",
      href: "https://cds.needtobeedgy.com/invite/tok",
      expiresOn: "18 Oct",
    });
    expect(v.preheader).toBe("Join as a Viewer.");
  });
});
