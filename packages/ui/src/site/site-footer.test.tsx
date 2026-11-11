// 07-25 Task 2: SiteFooter SSR (CONT-13; D249, D-UI-P7-30; 07-25 choices 14, 15).
import {
  REPORT_ARIA_LABEL,
  resolveFooter,
  validateFooter,
  type FooterBusinessInput,
  type ResolvedFooter,
} from "@cds/core/content";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./SiteFooter";

const open = (start: string, end: string) => ({
  open: true,
  ranges: [{ start, end }],
});
const closed = { open: false, ranges: [] };

const BUSINESS: FooterBusinessInput = {
  name: "Rivera Bakery",
  phone: "(512) 555-0100",
  public_email: "hi@rivera.test",
  address: { street: "12 Oak St", city: "Austin", state: "TX", zip: "78701" },
  time_zone: "America/Chicago",
  hours: {
    mon: open("09:00", "17:00"),
    tue: open("09:00", "17:00"),
    wed: open("09:00", "17:00"),
    thu: open("09:00", "17:00"),
    fri: open("09:00", "17:00"),
    sat: open("10:00", "14:00"),
    sun: closed,
  },
  socials: [{ platform: "instagram", url: "https://instagram.com/rivera" }],
};

const PAGE = "aaaaaaaaaaaaaa1";

function footer(over: Record<string, unknown> = {}): ResolvedFooter {
  return resolveFooter(
    validateFooter({
      extra_links: [{ id: "p", label: "Privacy", target: `page:${PAGE}` }],
      ...over,
    }),
    {
      business: BUSINESS,
      pages: new Map([[PAGE, { path: "/privacy", title: "Privacy" }]]),
      year: 2026,
    },
  );
}

const REPORT = "https://cds.test/report?site=rivera.test";

describe("SiteFooter", () => {
  const html = renderToStaticMarkup(
    <SiteFooter footer={footer()} reportHref={REPORT} />,
  );

  it("renders three columns headed by h2 and no h1", () => {
    expect(html.match(/<footer/g)).toHaveLength(1);
    expect(html.match(/<h2/g)).toHaveLength(3);
    expect(html).toContain(">Rivera Bakery</h2>");
    expect(html).toContain(">Hours</h2>");
    expect(html).toContain(">Links</h2>");
    expect(html).not.toContain("<h1");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(/);
  });

  it("renders address, tel, mailto and the social link with its name", () => {
    expect(html).toMatch(
      /<address[^>]*>.*12 Oak St.*Austin, TX 78701.*<\/address>/,
    );
    expect(html).toContain('href="tel:5125550100"');
    expect(html).toContain('href="mailto:hi@rivera.test"');
    expect(html).toContain('aria-label="Rivera Bakery on Instagram"');
    expect(html).toContain("<svg");
  });

  it("groups identical consecutive days", () => {
    expect(html).toContain("Mon–Fri 9:00 am to 5:00 pm");
    expect(html).toContain("Sat 10:00 am to 2:00 pm");
    expect(html).not.toContain("Sun");
  });

  it("bottom row: copyright, cookie choices slot, Report in the same tab", () => {
    const out = renderToStaticMarkup(
      <SiteFooter
        footer={footer()}
        reportHref={REPORT}
        cookieChoices={<button type="button">Cookie choices</button>}
      />,
    );
    expect(out).toContain("© 2026 Rivera Bakery");
    expect(out).toContain("Cookie choices");
    const report = out.match(
      /<a [^>]*aria-label="Report this site to Support"[^>]*>Report<\/a>/,
    );
    expect(report).not.toBeNull();
    expect(report![0]).toContain(`href="${REPORT}"`);
    expect(report![0]).not.toContain("target=");
  });

  it("keeps the Report link with every switch off, no business and no links", () => {
    const bare = resolveFooter(
      {
        show_address: false,
        show_hours: false,
        show_socials: false,
        extra_links: [],
        copyright: "",
        held: false,
      },
      {
        business: { ...BUSINESS, name: "", phone: "", public_email: "" },
        pages: new Map(),
        year: 2026,
      },
    );
    const out = renderToStaticMarkup(
      <SiteFooter footer={bare} reportHref={REPORT} />,
    );
    expect(out).not.toContain("<h2");
    expect(out).toContain(`aria-label="${REPORT_ARIA_LABEL}"`);
  });

  it("hidden parts collapse", () => {
    const out = renderToStaticMarkup(
      <SiteFooter
        footer={footer({ show_hours: false, extra_links: [] })}
        reportHref={REPORT}
      />,
    );
    expect(out.match(/<h2/g)).toHaveLength(1);
    expect(out).not.toContain("Hours");
  });
});

// 09-22: Privacy · Terms before the permanent Report link (AGR-08, AGR-09; D217, D249).
describe("SiteFooter policy links", () => {
  const plain = footer({ extra_links: [] });
  const REPORT_RE =
    /<a [^>]*aria-label="Report this site to Support"[^>]*>Report<\/a>/;

  it("renders copyright, Privacy, Terms, then Report, in order", () => {
    const out = renderToStaticMarkup(
      <SiteFooter
        footer={plain}
        reportHref={REPORT}
        policyLinks={{ privacy: true, terms: true }}
      />,
    );
    const c = out.indexOf("© 2026 Rivera Bakery");
    const p = out.indexOf('href="/privacy"');
    const t = out.indexOf('href="/terms"');
    const r = out.search(REPORT_RE);
    expect(c).toBeGreaterThan(-1);
    expect(p).toBeGreaterThan(c);
    expect(t).toBeGreaterThan(p);
    expect(r).toBeGreaterThan(t);
    expect(out).toMatch(/<a [^>]*href="\/privacy"[^>]*>Privacy<\/a>/);
    expect(out).toMatch(/<a [^>]*href="\/terms"[^>]*>Terms<\/a>/);
  });

  it("policy links share the Report link's class (44px targets, text-muted)", () => {
    const out = renderToStaticMarkup(
      <SiteFooter
        footer={plain}
        reportHref={REPORT}
        policyLinks={{ privacy: true, terms: true }}
      />,
    );
    const cls = (re: RegExp) => out.match(re)?.[1];
    const report = cls(
      /aria-label="Report this site to Support" class="([^"]*)"/,
    );
    const privacy = cls(/<a [^>]*href="\/privacy"[^>]*class="([^"]*)"/);
    expect(privacy).toBeDefined();
    expect(privacy).toContain("min-h-11");
    expect(privacy).toContain("text-site-text-muted");
    expect(privacy).toBe(report);
  });

  it("shows only the published page", () => {
    const out = renderToStaticMarkup(
      <SiteFooter
        footer={plain}
        reportHref={REPORT}
        policyLinks={{ privacy: false, terms: true }}
      />,
    );
    expect(out).not.toContain('href="/privacy"');
    expect(out).toContain('href="/terms"');
    expect(out).toMatch(REPORT_RE);
  });

  it("without policy links (or both false) the bottom row is unchanged and Report stays", () => {
    const before = renderToStaticMarkup(
      <SiteFooter footer={plain} reportHref={REPORT} />,
    );
    const off = renderToStaticMarkup(
      <SiteFooter
        footer={plain}
        reportHref={REPORT}
        policyLinks={{ privacy: false, terms: false }}
      />,
    );
    expect(off).toBe(before);
    expect(before).not.toContain('href="/privacy"');
    expect(before).not.toContain('href="/terms"');
    expect(before).toMatch(REPORT_RE);
  });
});
