// 15-18 (HUB-01, HUB-03; D168, D215, P15-P13, P15-P15; T-15-18-01..03): /work, /about,
// /independent-pros, /hosting-rules, /privacy, /unsubscribe. Imports the shared marketing mocks
// first (P15-P27).
import { DEMO_URL, mockMarketingData } from "./helpers/marketing-mocks";
import {
  ABOUT_FACTS,
  INDEPENDENT_PRO_CODE,
  MK_COPY,
  WORK_SITES,
} from "@cds/core/marketing";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as aboutModule from "../app/(platform)/(marketing)/about/page";
import * as indieModule from "../app/(platform)/(marketing)/independent-pros/page";
import * as workModule from "../app/(platform)/(marketing)/work/page";
import * as hostingModule from "../app/(platform)/(marketing)/hosting-rules/page";
import * as privacyModule from "../app/(platform)/(marketing)/privacy/page";
import * as unsubModule from "../app/(platform)/(marketing)/unsubscribe/page";
import { AUP_CATEGORIES } from "@cds/core/onboarding";

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function render(
  Page: () => ReactElement | Promise<ReactElement>,
): Promise<string> {
  return renderToStaticMarkup((await Page()) as ReactElement);
}

const ALL_PAGES = [
  workModule,
  aboutModule,
  indieModule,
  hostingModule,
  privacyModule,
  unsubModule,
];

const h1Count = (html: string) => (html.match(/<h1[\s>]/g) ?? []).length;
const unescape = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');

describe("read pages: dynamic, one H1", () => {
  it("every page is force-dynamic with no ISR (P15-P3)", () => {
    for (const m of ALL_PAGES) {
      expect(m.dynamic).toBe("force-dynamic");
      expect("revalidate" in m).toBe(false);
      expect("generateStaticParams" in m).toBe(false);
    }
  });

  it("each page renders exactly one H1", async () => {
    mockMarketingData();
    for (const m of ALL_PAGES) {
      expect(h1Count(await render(m.default))).toBe(1);
    }
  });

  it("metadata: noindex outside production, canonical on the apex in production", async () => {
    mockMarketingData();
    const dev = await workModule.generateMetadata();
    expect(dev.title).toBe(MK_COPY.SEO.WORK_TITLE);
    expect(dev.robots).toEqual({ index: false, follow: false });
    expect(dev.alternates?.canonical).toBeUndefined();
    mockMarketingData({ production: true });
    const prod = await aboutModule.generateMetadata();
    expect(prod.robots).toBeUndefined();
    expect(prod.alternates?.canonical).toBe(
      "https://connectionsdesignstudios.com/about",
    );
  });
});

describe("/work", () => {
  it("dev: demo panel, every site with a DRAFT badge, closing CTA, no empty line", async () => {
    mockMarketingData();
    const html = await render(workModule.default);
    expect(html).toContain(`href="${DEMO_URL}"`);
    for (const s of WORK_SITES) expect(unescape(html)).toContain(s.name);
    expect(unescape(html)).toContain(MK_COPY.WORK.SITES_H2);
    expect(html).toContain(MK_COPY.COMMON.DRAFT);
    expect(html).not.toContain('data-testid="mk-work-empty"');
    expect(unescape(html)).toContain(MK_COPY.WORK.CLOSING_H2);
    expect(html).toContain('href="/start"');
  });

  it("production: unconfirmed proof hides and the empty line shows", async () => {
    mockMarketingData({ production: true });
    const html = await render(workModule.default);
    for (const s of WORK_SITES.filter((x) => !x.confirmed)) {
      expect(unescape(html)).not.toContain(s.name);
    }
    expect(unescape(html)).not.toContain(MK_COPY.WORK.SAY_H2);
    expect(html).toContain('data-testid="mk-work-empty"');
    expect(unescape(html)).toContain(MK_COPY.WORK.EMPTY);
    expect(html).not.toContain(`>${MK_COPY.COMMON.DRAFT}<`);
  });

  it("the demo panel hides when the demo URL can't be resolved", async () => {
    mockMarketingData({ demoUrl: null });
    const html = await render(workModule.default);
    expect(html).not.toContain(MK_COPY.HOME.OPEN_DEMO);
  });
});

describe("/about", () => {
  it("renders the spec sections and only the inventory facts (dev, with DRAFT)", async () => {
    mockMarketingData();
    const html = unescape(await render(aboutModule.default));
    expect(html).toContain(MK_COPY.ABOUT.H1);
    for (const h of MK_COPY.ABOUT.HOW) expect(html).toContain(h.title);
    expect(html).toContain(MK_COPY.ABOUT.WHO_H2);
    expect(html).toContain('href="/standard"');
    expect(html).toContain('href="/studio"');
    const dl =
      /<dl[^>]*data-testid="mk-about-facts"[^>]*>([\s\S]*?)<\/dl>/.exec(html);
    expect(dl).not.toBeNull();
    const terms = [...dl![1]!.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map(
      (m) => m[1],
    );
    expect(terms).toEqual(ABOUT_FACTS.map((f) => f.label));
    for (const f of ABOUT_FACTS) expect(dl![1]).toContain(f.value);
    expect(dl![1]).toContain(MK_COPY.COMMON.DRAFT);
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/start"');
  });

  it("production hides unconfirmed facts (no invented facts ever shown)", async () => {
    mockMarketingData({ production: true });
    const html = await render(aboutModule.default);
    const shown = ABOUT_FACTS.filter((f) => f.confirmed);
    if (shown.length === 0) {
      expect(html).not.toContain('data-testid="mk-about-facts"');
    }
    // The business name is also in the lead copy; check the facts the copy never states.
    for (const f of ABOUT_FACTS.filter(
      (x) => !x.confirmed && !MK_COPY.ABOUT.LEAD.includes(x.value),
    )) {
      expect(html).not.toContain(f.value);
    }
  });
});

describe("/independent-pros", () => {
  it("states the D168 offer, the neutral rule and both CTAs", async () => {
    mockMarketingData();
    const html = unescape(await render(indieModule.default));
    expect(html).toContain(MK_COPY.INDIE.H1);
    expect(html).toContain(MK_COPY.INDIE.LEAD);
    for (const s of MK_COPY.INDIE.STEPS) expect(html).toContain(s);
    expect(html).toContain(MK_COPY.INDIE.NEUTRAL);
    expect(html).toContain('href="/start"');
    expect(html).toContain(
      'href="/contact?topic=question&about=independent-pro"',
    );
  });

  it("no code line while INDEPENDENT_PRO_CODE is null; the mention line instead", async () => {
    expect(INDEPENDENT_PRO_CODE).toBeNull();
    mockMarketingData();
    const html = unescape(await render(indieModule.default));
    expect(html).not.toContain('data-testid="mk-indie-code"');
    expect(html).not.toContain("at checkout");
    expect(html).toContain(MK_COPY.INDIE.NO_CODE);
  });
});

const listItems = (html: string, testId: string): string[] => {
  const m = new RegExp(
    `<ul[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</ul>`,
  ).exec(html);
  if (!m) return [];
  return [...m[1]!.matchAll(/<strong[^>]*>([^<]*)<\/strong>/g)].map(
    (x) => x[1]!,
  );
};

describe("/hosting-rules", () => {
  it("lists every never and review category from AUP_CATEGORIES and links /report", async () => {
    mockMarketingData();
    const html = unescape(await render(hostingModule.default));
    expect(html).toContain(MK_COPY.HOSTING.H1);
    expect(html).toContain(MK_COPY.HOSTING.NEVER_H2);
    expect(html).toContain(MK_COPY.HOSTING.REVIEWED_H2);
    const never = AUP_CATEGORIES.filter((c) => c.verdict === "never");
    const review = AUP_CATEGORIES.filter((c) => c.verdict === "review");
    expect(never.length).toBeGreaterThan(0);
    expect(listItems(html, "mk-aup-never")).toEqual(never.map((c) => c.name));
    expect(listItems(html, "mk-aup-review")).toEqual(review.map((c) => c.name));
    expect(html).toContain('href="/report"');
    expect(html).toContain(MK_COPY.HOSTING.REPORT_LINK);
  });

  it("takedown steps come from the compiled AUP section, without script", async () => {
    mockMarketingData();
    const html = unescape(await render(hostingModule.default));
    expect(html).toContain(MK_COPY.HOSTING.TAKEDOWN_H2);
    expect(html).toContain("gives you 3 days to fix it");
    expect(html).not.toContain("clause:");
    expect(html).not.toMatch(/<script/i);
  });

  it("is indexable in production", async () => {
    mockMarketingData({ production: true });
    const meta = await hostingModule.generateMetadata();
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe(
      "https://connectionsdesignstudios.com/hosting-rules",
    );
  });
});

describe("/privacy", () => {
  it("shows the DRAFT band, Last updated and the rendered notice", async () => {
    mockMarketingData({ production: true });
    const html = unescape(await render(privacyModule.default));
    expect(html).toContain('data-testid="mk-privacy-draft"');
    expect(html).toContain(MK_COPY.PRIVACY.DRAFT);
    expect(html).toContain(MK_COPY.PRIVACY.UPDATED);
    // WR-B06 reworded "Stopping abuse" and bumped the date.
    expect(html).toContain('dateTime="2026-10-18"');
    expect(html).toContain("October 18, 2026");
    expect(html).toContain("<h2>");
    expect(html).toContain('href="mailto:hello@connectionsdesignstudios.com"');
    expect(html).not.toMatch(/<script/i);
  });
});

describe("/unsubscribe", () => {
  it("says the newsletter ended, links home, and is noindex even in production", async () => {
    mockMarketingData({ production: true });
    const html = unescape(await render(unsubModule.default));
    expect(html).toContain(MK_COPY.UNSUB.H1);
    expect(html).toContain(MK_COPY.UNSUB.BODY);
    expect(html).toContain('href="/"');
    const meta = await unsubModule.generateMetadata();
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });
});
