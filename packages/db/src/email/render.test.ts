// Email templates (EMAIL-01, UI-SPEC "Emails", D-UI-P6-33, T-06-25).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { layout } from "./render/layout";
import { renderEmail, type EmailData } from "./render/templates";

const EXP = new Date("2026-10-28T12:00:00.000Z");
const LINK = "https://cds.needtobeedgy.com/start/q/abc";
const UNSUB = "https://cds.needtobeedgy.com/start/unsubscribe?t=tok";
const UNSUB_POST = "https://cds.needtobeedgy.com/api/unsubscribe?t=tok";

const saved: EmailData["quote.saved"] = {
  pathLabel: "Standard",
  addonCount: 2,
  buildCents: 150000,
  monthlyCents: 3900,
  dueCents: 25000,
  expiresAt: EXP,
  link: LINK,
};
const reminder = (day: 1 | 3): EmailData["quote.reminder"] => ({
  day,
  pathLabel: "Standard",
  expiresAt: EXP,
  link: LINK,
  unsubscribeLink: UNSUB,
  unsubscribePostUrl: UNSUB_POST,
});

let savedAddr: string | undefined;
beforeEach(() => {
  savedAddr = process.env.CDS_POSTAL_ADDRESS;
  delete process.env.CDS_POSTAL_ADDRESS;
});
afterEach(() => {
  if (savedAddr === undefined) delete process.env.CDS_POSTAL_ADDRESS;
  else process.env.CDS_POSTAL_ADDRESS = savedAddr;
});

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

function all() {
  return [
    renderEmail("quote.saved", saved),
    renderEmail("quote.reminder", reminder(1)),
    renderEmail("quote.reminder", reminder(3)),
    renderEmail("email.confirm", {
      orgName: "Rivera Bakery",
      purposeLabel: "website inquiries",
      link: LINK,
    }),
    renderEmail("fit.approved", { orgName: "Rivera Bakery", link: LINK }),
    renderEmail("fit.declined", { orgName: "Rivera Bakery" }),
  ];
}

describe("subjects and preheaders (UI-SPEC Emails)", () => {
  it("quote.saved", () => {
    const m = renderEmail("quote.saved", saved);
    expect(m.subject).toBe("Your website quote");
    expect(m.preheader).toBe(
      "Standard website: $1,500 build, then $39 a month.",
    );
    expect(m.text).toContain(
      "Here's the quote you saved: a Standard website with 2 add-ons.",
    );
    expect(m.text).toContain("Your link works until 28 Oct.");
    expect(m.text).toContain("Due at checkout");
    expect(m.text).toContain("$250");
    expect(m.html).toContain("Open my quote");
  });

  it("quote.reminder day 1 and day 3", () => {
    const d1 = renderEmail("quote.reminder", reminder(1));
    expect(d1.subject).toBe("Your website quote is saved");
    expect(d1.preheader).toBe("Pick up right where you left off.");
    expect(d1.html).toContain("Pick up where I left off");
    expect(d1.text).not.toContain("This is the last reminder.");
    const d3 = renderEmail("quote.reminder", reminder(3));
    expect(d3.subject).toBe("Still thinking about your website?");
    expect(d3.preheader).toBe("Your quote is saved until 28 Oct.");
    expect(d3.text).toContain("This is the last reminder.");
    expect(d3.html).toContain("This is the last reminder.");
  });

  it("email.confirm, fit.approved, fit.declined", () => {
    const c = renderEmail("email.confirm", {
      orgName: "Rivera Bakery",
      purposeLabel: "website inquiries",
      link: LINK,
    });
    expect(c.subject).toBe("Confirm your email for Rivera Bakery");
    expect(c.preheader).toBe("One click and you're set.");
    expect(c.html).toContain("Confirm this address");
    expect(c.text).toContain("The link works for 7 days.");
    const a = renderEmail("fit.approved", { orgName: "X", link: LINK });
    expect(a.subject).toBe("Your site is cleared");
    expect(a.text).toContain(
      "Thanks for waiting. Your site is cleared, and you can keep setting it up.",
    );
    expect(a.html).toContain("Continue setup");
    const d = renderEmail("fit.declined", { orgName: "X" });
    expect(d.subject).toBe("About your website with CDS");
    expect(d.text).toContain(
      "We've looked at your answers and can't host this site. Reply to this email if you think we got it wrong.",
    );
    expect(count(d.html, /<a /g)).toBe(0);
  });
});

describe("agreement.signed (09-13, UI-SPEC Email agreement.signed)", () => {
  const DL =
    "https://cds.needtobeedgy.com/hub/agreement/download/abc123def456ghi";
  const HASH = "a".repeat(64);
  const signed = (
    over: Partial<EmailData["agreement.signed"]> = {},
  ): EmailData["agreement.signed"] => ({
    firstName: "Ana",
    orgName: "Rivera Bakery",
    signedDate: "8 Oct 2026",
    signedTime: "7:14 pm UTC",
    policies: ["Service Agreement, version 1", "Terms of Service, version 2"],
    link: DL,
    proofCode: HASH,
    ...over,
  });

  it("subject, preheader, body, list, button, proof code, footer", () => {
    const m = renderEmail("agreement.signed", signed());
    expect(m.subject).toBe("Your signed CDS agreement");
    expect(m.preheader).toBe(
      "Signed 8 Oct 2026 for Rivera Bakery. Download your copy any time.",
    );
    for (const part of [m.html, m.text]) {
      expect(part).toContain("Hi Ana,");
      expect(part).toContain("Service Agreement, version 1");
      expect(part).toContain("Terms of Service, version 2");
      expect(part).toContain("Download your signed copy");
      expect(part).toContain(HASH);
      expect(part.replace(/&#39;/g, "'")).toContain(
        "You're getting this because you signed an agreement with CDS.",
      );
      expect(part).toContain("Settings › Legal");
    }
    expect(m.text).toContain(
      "Hi Ana, here's a record of the agreement you signed for Rivera Bakery on 8 Oct 2026 at 7:14 pm UTC.",
    );
    expect(m.html).toMatch(
      new RegExp(`<a href="${DL}"[^>]*>Download your signed copy</a>`),
    );
    expect(m.text.split("\n")).toContain(DL);
    expect(count(m.html, /min-height:44px/g)).toBe(1);
    expect(m.html).toContain("<ul");
    expect(count(m.html, /<li/g)).toBe(2);
  });

  it("escapes every value", () => {
    const m = renderEmail(
      "agreement.signed",
      signed({
        orgName: "<b>x</b>",
        firstName: "<i>A</i>",
        policies: ["<script>1</script>"],
      }),
    );
    expect(m.html).not.toContain("<b>x</b>");
    expect(m.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(m.html).not.toContain("<i>A</i>");
    expect(m.html).not.toContain("<script>");
  });
});

describe("layout contract", () => {
  it("lang=en, 600px table, light-only, preheader, no images", () => {
    for (const m of all()) {
      expect(m.html).toContain('<html lang="en">');
      expect(m.html).toMatch(/width="600"/);
      expect(m.html).toContain('content="light only"');
      expect(m.html).toContain(m.preheader.replace(/'/g, "&#39;"));
      expect(m.html).not.toMatch(/<img/i);
      expect(m.html).toContain("DRAFT: address pending");
    }
  });

  it("exactly one button per email with a button, 44px min-height", () => {
    for (const m of all().slice(0, 5)) {
      expect(count(m.html, /min-height:44px/g)).toBe(1);
    }
    expect(count(all()[5]!.html, /min-height:44px/g)).toBe(0);
  });

  it("text part carries the full URL on its own line", () => {
    for (const m of all().slice(0, 5)) {
      expect(m.text.split("\n")).toContain(LINK);
    }
  });

  it("reminder footer links Unsubscribe to the GET landing page", () => {
    const m = renderEmail("quote.reminder", reminder(1));
    expect(m.html).toMatch(
      new RegExp(
        `<a [^>]*href="${UNSUB.replace(/[.?]/g, "\\$&")}"[^>]*>Unsubscribe</a>`,
      ),
    );
    expect(m.text).toContain("Don't want reminders? Unsubscribe:");
    expect(m.text.split("\n")).toContain(UNSUB);
  });

  it("uses the postal address from env when set", () => {
    process.env.CDS_POSTAL_ADDRESS = "1 Main St, Austin TX";
    const m = renderEmail("fit.declined", { orgName: "X" });
    expect(m.html).toContain("1 Main St, Austin TX");
    expect(m.text).toContain("1 Main St, Austin TX");
  });
});

describe("escaping (T-06-25)", () => {
  it("escapes an injected org name everywhere in the HTML", () => {
    const evil = "<script>alert(1)</script>";
    const m = renderEmail("email.confirm", {
      orgName: evil,
      purposeLabel: '"><b>x',
      link: LINK,
    });
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).not.toContain("<script");
    expect(m.html).not.toContain('"><b>');
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("strips CR/LF from subjects", () => {
    const m = renderEmail("email.confirm", {
      orgName: "A\r\nBcc: x@y.z",
      purposeLabel: "x",
      link: LINK,
    });
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("refuses a non-http(s) button link", () => {
    expect(() =>
      renderEmail("fit.approved", {
        orgName: "X",
        link: "javascript:alert(1)",
      }),
    ).toThrow();
    expect(() =>
      layout({
        preheader: "p",
        bodyHtml: "",
        bodyText: "",
        button: { label: "Go", href: "data:text/html,x" },
        footerHtml: "",
        footerText: "",
      }),
    ).toThrow();
  });
});

describe("dates", () => {
  it("renders 28 Oct in UTC, en-GB day month", () => {
    const m = renderEmail("quote.saved", {
      ...saved,
      expiresAt: new Date("2026-10-28T23:30:00.000Z"),
    });
    expect(m.text).toContain("28 Oct");
  });
});

// P7 (07-01): form.submission (owner words: "message") and the staff media.alert.
const INBOX = "https://cds.needtobeedgy.com/hub/inbox?m=abc";
const message = (
  over: Partial<EmailData["form.submission"]> = {},
): EmailData["form.submission"] => ({
  siteName: "Rivera Bakery",
  formName: "Contact",
  pageTitle: "Home",
  answers: [
    { label: "Name", value: "Pat" },
    { label: "Message", value: "Line one\nLine two" },
  ],
  newsletter: null,
  replyable: true,
  inboxLink: INBOX,
  submittedAt: EXP,
  ...over,
});

describe("form.submission (CONT-25, T-07-06)", () => {
  it("subject, preheader and intro use the form and page names", () => {
    const m = renderEmail("form.submission", message());
    expect(m.subject).toBe("New message from your website: Contact");
    expect(m.preheader).toBe("Contact form on Home");
    expect(m.html).toContain(
      "Someone sent a message through your Contact form on Home.",
    );
    const noPage = renderEmail("form.submission", message({ pageTitle: null }));
    expect(noPage.preheader).toBe("Contact form");
    expect(noPage.text).toContain(
      "Someone sent a message through your Contact form.",
    );
  });

  it("lists every answer as a bold label and a value, keeping line breaks", () => {
    const m = renderEmail("form.submission", message());
    expect(m.html).toContain(
      '<td style="padding:8px 0 0;font-weight:600">Name</td>',
    );
    expect(m.html).toContain("Line one<br>Line two");
    expect(m.text).toContain("Name: Pat");
    expect(m.text).toContain("Message: Line one\nLine two");
  });

  it("has exactly one Open Inbox button and the text part carries the link", () => {
    const m = renderEmail("form.submission", message());
    expect(count(m.html, /min-height:44px/g)).toBe(1);
    expect(m.html).toContain(">Open Inbox</a>");
    expect(m.text.split("\n")).toContain(INBOX);
  });

  it("shows Newsletter: Agreed only when the visitor agreed", () => {
    expect(
      renderEmail("form.submission", message({ newsletter: true })).html,
    ).toContain("Newsletter: Agreed");
    expect(
      renderEmail("form.submission", message({ newsletter: true })).text,
    ).toContain("Newsletter: Agreed");
    for (const newsletter of [false, null]) {
      const m = renderEmail("form.submission", message({ newsletter }));
      expect(m.html).not.toContain("Newsletter");
      expect(m.text).not.toContain("Newsletter");
    }
  });

  it("adds the reply line only when the message is replyable", () => {
    const reply = "Reply to this email to answer them.";
    expect(renderEmail("form.submission", message()).text).toContain(reply);
    const m = renderEmail("form.submission", message({ replyable: false }));
    expect(m.html).not.toContain(reply);
    expect(m.text).not.toContain(reply);
  });

  it("footer names the site", () => {
    expect(renderEmail("form.submission", message()).html).toContain(
      "You&#39;re getting this because Rivera Bakery&#39;s website sends form messages to this address.",
    );
  });

  it("escapes injected markup in labels, values, the form name and the site name", () => {
    const evil = "<script>alert(1)</script>";
    const m = renderEmail(
      "form.submission",
      message({
        siteName: evil,
        formName: `${evil}\r\nBcc: x@y.z`,
        pageTitle: evil,
        answers: [{ label: evil, value: `${evil}\n<b>x</b>` }],
      }),
    );
    expect(m.html).not.toContain("<script");
    expect(m.html).not.toContain("<b>x</b>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

// P10 (10-36): Forms Pro auto-reply, the owner's words sent as the tenant (BILL-14, D233).
const autoReply = (
  over: Partial<EmailData["form.auto_reply"]> = {},
): EmailData["form.auto_reply"] => ({
  orgName: "Rivera Bakery",
  subject: "Thanks, Pat",
  body: "We got your message.\nWe'll reply within a day.",
  ...over,
});

describe("form.auto_reply (BILL-14, D233, T-10-36-03)", () => {
  it("uses the owner's subject and body, keeping line breaks", () => {
    const m = renderEmail("form.auto_reply", autoReply());
    expect(m.subject).toBe("Thanks, Pat");
    expect(m.preheader).toBe("We got your message.");
    expect(m.html).toContain(
      "We got your message.<br>We&#39;ll reply within a day.",
    );
    expect(m.text).toContain("We got your message.\nWe'll reply within a day.");
  });

  it("has no button", () => {
    const m = renderEmail("form.auto_reply", autoReply());
    expect(count(m.html, /min-height:44px/g)).toBe(0);
  });

  it("footer and wordmark name the org", () => {
    const m = renderEmail("form.auto_reply", autoReply(), {
      brand: "Rivera Bakery",
    });
    const why =
      "You&#39;re getting this because you sent a form on Rivera Bakery&#39;s website.";
    expect(m.html).toContain(why);
    expect(m.text).toContain(
      "You're getting this because you sent a form on Rivera Bakery's website.",
    );
  });

  it("escapes markup in the body and org name; the subject is header-safe", () => {
    const evil = "<script>alert(1)</script>";
    const m = renderEmail(
      "form.auto_reply",
      autoReply({
        orgName: evil,
        subject: `Hi\r\nBcc: x@y.z`,
        body: `${evil}\n<b>x</b>`,
      }),
    );
    expect(m.html).not.toContain("<script");
    expect(m.html).not.toContain("<b>x</b>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

describe("media.alert (CONT-19/20, D221, D278)", () => {
  const alert = (
    over: Partial<EmailData["media.alert"]> = {},
  ): EmailData["media.alert"] => ({
    event: "cdn-fallback-start",
    at: EXP,
    orgName: null,
    detail: "The CDN health check failed three times.",
    link: "https://cds.needtobeedgy.com/runbooks/media-cdn",
    ...over,
  });

  it("renders one subject per event", () => {
    expect(renderEmail("media.alert", alert()).subject).toBe(
      "Media CDN is down: serving media from the app",
    );
    expect(
      renderEmail("media.alert", alert({ event: "cdn-fallback-cap" })).subject,
    ).toBe("Media CDN down 72 hours: videos paused");
    expect(
      renderEmail(
        "media.alert",
        alert({ event: "over-allowance", orgName: "Rivera Bakery" }),
      ).subject,
    ).toBe("Rivera Bakery is over its 2 GB media allowance");
  });

  it("shows the detail, the since date and a runbook button only with a link", () => {
    const m = renderEmail("media.alert", alert());
    expect(m.text).toContain("The CDN health check failed three times.");
    expect(m.text).toContain("Since 28 Oct");
    expect(m.html).toContain(">Open runbook</a>");
    expect(m.html).toContain("CDS staff alert.");
    const noLink = renderEmail("media.alert", alert({ link: null }));
    expect(count(noLink.html, /min-height:44px/g)).toBe(0);
  });

  it("escapes the org name and strips CR/LF from the subject", () => {
    const m = renderEmail(
      "media.alert",
      alert({
        event: "over-allowance",
        orgName: "<script>x</script>\r\nBcc: a@b.c",
      }),
    );
    expect(m.html).not.toContain("<script");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

// P8 (08-10): staff hand-off emails (TMPL-04, CONTEXT A4-Q1, A2-Q4; D-UI-P8-27, -28).
const ORG = "abcdefghijklmno";
const HOME = "https://rivera-bakery.sites.connectionsdesignstudios.com/";
const ABOUT = "https://rivera-bakery.sites.connectionsdesignstudios.com/about";
const AT = new Date("2026-10-07T19:14:00.000Z"); // 2:14 pm CT

/** Visible words of the HTML body: tags out, entities decoded, whitespace collapsed. */
function htmlWords(html: string): string {
  return html
    .replace(/<div style="display:none[^>]*>.*?<\/div>/s, " ")
    .replace(/<title>.*?<\/title>/s, " ")
    .replace(/<style>.*?<\/style>/s, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Every text line (bar the button label and the footer rule) appears in the HTML. */
function expectParity(m: { html: string; text: string }, button?: string) {
  const words = htmlWords(m.html);
  for (const line of m.text.split("\n")) {
    const l = line.replace(/\s+/g, " ").trim();
    if (!l || l === "--" || (button && l === `${button}:`)) continue;
    expect(words, l).toContain(l);
  }
}

const assembled = (
  over: Partial<EmailData["site.assembled"]> = {},
): EmailData["site.assembled"] => ({
  businessName: "Rivera Bakery",
  pathLabel: "Standard",
  businessTypeLabel: "Bakery",
  templateId: "standard-v1",
  templateVersion: 1,
  assembledAt: AT,
  orgId: ORG,
  pages: [
    { label: "Home", url: HOME },
    { label: "About", url: ABOUT },
  ],
  polish: [
    "Hero · Default used · No main photo: text-only hero",
    "Questions and answers · 2 of 3 need answers; they stay hidden until answered",
    "Theme: import the impeccable theme (D45)",
  ],
  filled: ["Intro", "Services (6 of 12)", "Hours and map"],
  leftOut: ["Proof (No add-on installed)"],
  ...over,
});

const failed = (
  over: Partial<EmailData["site.assembly_failed"]> = {},
): EmailData["site.assembly_failed"] => ({
  businessName: "Rivera Bakery",
  errorCode: "PUBLISH_FAILED",
  page: "About",
  finishedPages: ["Home"],
  lastTry: AT,
  orgId: ORG,
  attempts: 3,
  ...over,
});

describe("site.assembled (TMPL-04, D-UI-P8-27)", () => {
  it("subject counts the polish items, or says ready to review", () => {
    expect(renderEmail("site.assembled", assembled()).subject).toBe(
      "Site assembled: Rivera Bakery (3 to polish)",
    );
    const none = renderEmail("site.assembled", assembled({ polish: [] }));
    expect(none.subject).toBe(
      "Site assembled: Rivera Bakery (ready to review)",
    );
    expect(none.html).not.toContain("To polish</");
    expect(none.text.split("\n")).not.toContain("To polish");
  });

  it("preheader, body, facts and pages per the UI-SPEC", () => {
    const m = renderEmail("site.assembled", assembled());
    expect(m.preheader).toBe(
      "Standard · Bakery · Home and About are on the preview address.",
    );
    const words = htmlWords(m.html);
    expect(m.text).toContain(
      "Rivera Bakery's site assembled from their answers. Review it, polish what's flagged, and it's ready for the owner.",
    );
    for (const fact of [
      "Business Rivera Bakery",
      "Path Standard",
      "Business type Bakery",
      "Template standard-v1 (v1)",
      "Assembled 7 Oct, 2:14 pm CT",
      `Org ${ORG}`,
    ]) {
      expect(words, fact).toContain(fact);
    }
    expect(words).toContain(`Home ${HOME}`);
    expect(words).toContain(`About ${ABOUT}`);
    const lines = m.text.split("\n");
    expect(lines).toContain(HOME);
    expect(lines).toContain(ABOUT);
  });

  it("lists To polish first, then Filled, then Left out", () => {
    const m = renderEmail("site.assembled", assembled());
    const t = m.text;
    const p = t.indexOf("To polish\n");
    const f = t.indexOf("Filled\n");
    const l = t.indexOf("Left out\n");
    expect(p).toBeGreaterThan(-1);
    expect(f).toBeGreaterThan(p);
    expect(l).toBeGreaterThan(f);
    expect(t).toContain("Hero · Default used · No main photo: text-only hero");
    expect(t).toContain("Services (6 of 12)");
    expect(t).toContain("Proof (No add-on installed)");
  });

  it("one Open the preview button to the first page, re-run line and staff footer", () => {
    const m = renderEmail("site.assembled", assembled());
    expect(count(m.html, /min-height:44px/g)).toBe(1);
    expect(m.html).toMatch(
      new RegExp(
        `href="${HOME.replace(/[.?/]/g, "\\$&")}"[^>]*>Open the preview</a>`,
      ),
    );
    expect(m.text).toContain(`Open the preview:\n${HOME}`);
    expect(m.text).toContain(
      `npm run site:assemble -- --org ${ORG} --rerun; pages anyone has edited are left alone.`,
    );
    expect(m.text).toContain("You're getting this because you're CDS staff.");
    expect(m.html).toContain(
      "You&#39;re getting this because you&#39;re CDS staff.",
    );
  });

  it("text and HTML carry the same words", () => {
    expectParity(
      renderEmail("site.assembled", assembled()),
      "Open the preview",
    );
    expectParity(
      renderEmail("site.assembled", assembled({ polish: [], leftOut: [] })),
      "Open the preview",
    );
  });

  it("escapes the business name and strips CR/LF from the subject", () => {
    const m = renderEmail(
      "site.assembled",
      assembled({ businessName: "<b>Bad</b>\r\nBcc: a@b.c" }),
    );
    expect(m.html).not.toContain("<b>Bad");
    expect(m.html).toContain("&lt;b&gt;Bad&lt;/b&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

describe("site.assembly_failed (CONTEXT A2-Q4, D-UI-P8-28)", () => {
  it("subject, preheader, body, facts and next step; no button", () => {
    const m = renderEmail("site.assembly_failed", failed());
    expect(m.subject).toBe("Site didn't assemble: Rivera Bakery");
    expect(m.preheader).toBe(
      "Stopped after 3 tries. The owner hasn't been told.",
    );
    expect(m.text).toContain(
      "Rivera Bakery's site stopped assembling after 3 tries. The owner hasn't been told; their setup page still says CDS has their details.",
    );
    const words = htmlWords(m.html);
    for (const fact of [
      "Error PUBLISH_FAILED",
      "Page About",
      "Finished pages Home",
      "Last try 7 Oct, 2:14 pm CT",
      `Org ${ORG}`,
    ]) {
      expect(words, fact).toContain(fact);
    }
    expect(m.text).toContain(
      `Look up the error code in the log, fix the cause, then run npm run site:assemble -- --org ${ORG}. It picks up where it stopped and never duplicates a page.`,
    );
    expect(count(m.html, /min-height:44px/g)).toBe(0);
    expect(m.text).toContain("You're getting this because you're CDS staff.");
    expectParity(m);
  });

  it("no finished pages reads None", () => {
    const words = htmlWords(
      renderEmail("site.assembly_failed", failed({ finishedPages: [] })).html,
    );
    expect(words).toContain("Finished pages None");
  });

  it("escapes the business name and strips CR/LF from the subject", () => {
    const m = renderEmail(
      "site.assembly_failed",
      failed({ businessName: "<b>Bad</b>\nX" }),
    );
    expect(m.html).not.toContain("<b>Bad");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

describe("P10 billing emails (10-03; UI-SPEC Emails; D214, D310)", () => {
  const HUB = "https://cds.needtobeedgy.com/hub/billing";
  const WHY = "You're getting this because you have a website with CDS.";
  const receipt = (
    over: Partial<EmailData["billing.receipt"]> = {},
  ): EmailData["billing.receipt"] => ({
    firstName: "Ana",
    orgName: "Rivera Bakery",
    paidOn: "8 Oct 2026",
    paidCents: 153900,
    taxCents: 0,
    lines: [
      { label: "Website build", cents: 150000 },
      { label: "Standard plan, October", cents: 3900 },
    ],
    nextBill: { date: "8 Nov 2026", cents: 3900 },
    invoiceUrl: HUB,
    ...over,
  });
  const lapsed: EmailData["billing.lapsed"] = {
    orgName: "Rivera Bakery",
    amountCents: 3900,
    addons: ["Testimonials", "Credentials"],
    payUrl: HUB,
  };
  const declined = (
    over: Partial<EmailData["org.declined"]> = {},
  ): EmailData["org.declined"] => ({
    refundedCents: 153900,
    reason: "fit",
    otherNote: null,
    deleteOn: "7 Nov 2026",
    agreementUrl: HUB,
    ...over,
  });
  const alert: EmailData["billing.staff_alert"] = {
    event: "stripe_restricted",
    orgName: "Rivera Bakery",
    orgId: "org123",
    detail: "Stripe needs an ID document.",
  };

  function allBilling() {
    return [
      renderEmail("billing.receipt", receipt()),
      renderEmail("billing.card_failed", {
        orgName: "Rivera Bakery",
        amountCents: 3900,
        date: "8 Nov",
        updateUrl: HUB,
      }),
      renderEmail("billing.lapsed", lapsed),
      renderEmail("billing.restored", {
        addons: ["Testimonials", "Credentials"],
        hubUrl: HUB,
      }),
      renderEmail("billing.quote_sent", {
        title: "Booking page redesign",
        scopeLine: "A new booking page with your three services.",
        totalCents: 500000,
        depositCents: 200000,
        validUntil: "7 Nov",
        quoteUrl: HUB,
      }),
      renderEmail("billing.stripe_setup", {
        orgName: "Rivera Bakery",
        setupUrl: HUB,
      }),
      renderEmail("org.declined", declined()),
    ];
  }

  it("every owner billing email has one button, the footer and the full URL in text", () => {
    for (const m of allBilling()) {
      expect(count(m.html, /min-height:44px/g), m.subject).toBe(1);
      expect(m.text, m.subject).toContain(WHY);
      expect(m.text.split("\n"), m.subject).toContain(HUB);
      expect(m.html).toContain('<html lang="en">');
    }
  });

  it("billing.receipt: subject, preheader, amounts, lines, next bill, button", () => {
    const m = renderEmail("billing.receipt", receipt());
    expect(m.subject).toBe("Your receipt from CDS");
    expect(m.preheader).toBe("$1,539.00 paid on 8 Oct 2026.");
    expect(m.text).toContain(
      "Thanks, Ana. We received $1,539.00 (including $0.00 sales tax) for Rivera Bakery's website.",
    );
    expect(m.text).toContain("Website build  $1,500.00");
    expect(m.text).toContain("Next bill: 8 Nov 2026, $39.00.");
    expect(m.html).toMatch(
      new RegExp(`<a href="${HUB}"[^>]*>View invoice</a>`),
    );
    expect(htmlWords(m.html)).toContain("Standard plan, October $39.00");
    const none = renderEmail("billing.receipt", receipt({ nextBill: null }));
    expect(none.text).not.toContain("Next bill");
  });

  it("billing.card_failed", () => {
    const m = allBilling()[1]!;
    expect(m.subject).toBe("Your card payment didn't go through");
    expect(m.preheader).toBe("Update your card to keep your add-ons on.");
    expect(m.text).toContain(
      "Your payment of $39.00 for Rivera Bakery on 8 Nov didn't go through. Your site and add-ons are still on.",
    );
    expect(m.html).toContain("Update card</a>");
  });

  it("billing.lapsed says paused and kept, never suspended, lapsed or deleted", () => {
    const m = renderEmail("billing.lapsed", lapsed);
    expect(m.subject).toBe("Your add-ons are paused");
    expect(m.preheader).toBe("Your pages are still live. Nothing was deleted.");
    expect(m.text).toContain(
      "We couldn't collect $39.00 after several tries, so Rivera Bakery's add-ons are paused: Testimonials, Credentials.",
    );
    expect(m.text).toContain(
      "Your site's pages are still live, and everything in Testimonials and Credentials is kept.",
    );
    expect(m.html).toContain("Update card and pay</a>");
    for (const part of [m.subject, m.text, htmlWords(m.html)]) {
      const p = part.replace(/Nothing was deleted/g, "");
      expect(p).not.toMatch(/suspended|lapsed|deleted/i);
    }
  });

  it("billing.restored", () => {
    const m = allBilling()[3]!;
    expect(m.subject).toBe("Your add-ons are back on");
    expect(m.preheader).toBe("Payment received. Thank you.");
    expect(m.text).toContain(
      "We received your payment, and Testimonials and Credentials are back on your site exactly as they were.",
    );
    expect(m.html).toContain("Open your hub</a>");
    const one = renderEmail("billing.restored", {
      addons: ["Testimonials"],
      hubUrl: HUB,
    });
    expect(one.text).toContain(
      "Testimonials is back on your site exactly as it was.",
    );
  });

  it("billing.quote_sent with and without a deposit", () => {
    const m = allBilling()[4]!;
    expect(m.subject).toBe("CDS sent you a quote: Booking page redesign");
    expect(m.preheader).toBe("$5,000. Valid until 7 Nov.");
    expect(m.text).toContain(
      "Here's the quote you asked for: Booking page redesign. A new booking page with your three services. Price $5,000, deposit today $2,000. No work starts until you accept it.",
    );
    expect(m.html).toContain("Review quote</a>");
    const noDep = renderEmail("billing.quote_sent", {
      title: "T",
      scopeLine: "S",
      totalCents: 50000,
      depositCents: null,
      validUntil: "7 Nov",
      quoteUrl: HUB,
    });
    expect(noDep.text).toContain("Price $500. No work starts");
    expect(noDep.text).not.toContain("deposit");
  });

  it("billing.stripe_setup", () => {
    const m = allBilling()[5]!;
    expect(m.subject).toBe("Finish setting up Stripe");
    expect(m.preheader).toBe("Online payments are paused on your site.");
    expect(m.text).toContain(
      "Stripe has paused payments on your account, so customers can't pay online right now.",
    );
    expect(m.html).toContain("Finish Stripe setup</a>");
  });

  it("org.declined renders each reason sentence and the keep paragraph", () => {
    const reasons = {
      fit: "Your business is a kind of site we don't host.",
      capacity:
        "We can't take on your build right now and didn't want to keep you waiting.",
      scope: "What your site needs is outside what CDS builds.",
    } as const;
    for (const [reason, line] of Object.entries(reasons)) {
      const m = renderEmail(
        "org.declined",
        declined({ reason: reason as keyof typeof reasons }),
      );
      expect(m.subject).toBe("About your CDS order");
      expect(m.preheader).toBe("We've refunded your payment in full.");
      expect(m.text).toContain(
        `CDS can't build this site, so we've refunded everything you paid, $1,539.00, to your card. It can take 5 to 10 business days to show. ${line}`,
      );
      expect(m.text).toContain(
        "Your preview site is offline. Your account and site details are deleted on 7 Nov 2026.",
      );
      expect(m.html).toContain("Download your signed agreement</a>");
    }
  });

  it("org.declined other uses the escaped staff note", () => {
    const m = renderEmail(
      "org.declined",
      declined({ reason: "other", otherNote: "<script>x</script> We're full" }),
    );
    expect(m.text).toContain("<script>x</script> We're full.");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    const empty = renderEmail(
      "org.declined",
      declined({ reason: "other", otherNote: null }),
    );
    expect(empty.text).toContain("It can take 5 to 10 business days to show.");
  });

  it("billing.staff_alert renders event, org, id, detail; no button", () => {
    const m = renderEmail("billing.staff_alert", alert);
    expect(m.subject).toBe("Stripe restricted: Rivera Bakery");
    const words = htmlWords(m.html);
    expect(words).toContain("Event stripe_restricted");
    expect(words).toContain("Org Rivera Bakery");
    expect(words).toContain("Org id org123");
    expect(words).toContain("Detail Stripe needs an ID document.");
    expect(count(m.html, /min-height:44px/g)).toBe(0);
    expect(m.text).toContain("You're getting this because you're CDS staff.");
    expectParity(m);
  });

  it("escapes org names, titles and notes, and strips CR/LF from subjects", () => {
    const evil = "<script>alert(1)</script>";
    const ms = [
      renderEmail(
        "billing.receipt",
        receipt({ orgName: evil, firstName: evil }),
      ),
      renderEmail("billing.lapsed", {
        ...lapsed,
        orgName: evil,
        addons: [evil],
      }),
      renderEmail("billing.quote_sent", {
        title: `${evil}\r\nBcc: x@y.z`,
        scopeLine: evil,
        totalCents: 100,
        depositCents: null,
        validUntil: "7 Nov",
        quoteUrl: HUB,
      }),
      renderEmail("billing.staff_alert", {
        ...alert,
        orgName: evil,
        detail: evil,
      }),
    ];
    for (const m of ms) {
      expect(m.html).not.toContain("<script");
      expect(m.html).toContain("&lt;script&gt;");
      expect(m.subject).not.toMatch(/[\r\n]/);
      expect(m.text.length).toBeGreaterThan(0);
    }
  });
});

// P10 (10-37): Forms Pro "save and finish later" link, sent as the tenant (BILL-14, D233).
const resumeLink = (
  over: Partial<EmailData["form.resume_link"]> = {},
): EmailData["form.resume_link"] => ({
  orgName: "Rivera Bakery",
  formName: "Catering request",
  link: "https://rivera.example/catering?resume=abc#form-f1",
  expires: "9 Nov 2026",
  ...over,
});

describe("form.resume_link (BILL-14, D233, 10-37)", () => {
  it("names the form, carries the link as a button and says when it expires", () => {
    const m = renderEmail("form.resume_link", resumeLink());
    expect(m.subject).toBe("Finish your Catering request form");
    expect(count(m.html, /min-height:44px/g)).toBe(1);
    expect(m.html).toContain("Finish your form");
    expect(m.html).toContain(
      "https://rivera.example/catering?resume=abc#form-f1",
    );
    expect(m.text).toContain(
      "https://rivera.example/catering?resume=abc#form-f1",
    );
    expect(m.text).toContain("9 Nov 2026");
    expect(m.text).toContain("Rivera Bakery");
  });

  it("escapes the org and form names; the subject is header-safe", () => {
    const evil = "<script>alert(1)</script>";
    const m = renderEmail(
      "form.resume_link",
      resumeLink({ orgName: evil, formName: `X\r\nBcc: x@y.z${evil}` }),
    );
    expect(m.html).not.toContain("<script");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});
