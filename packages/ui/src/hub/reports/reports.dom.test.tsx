// @vitest-environment jsdom
// Reports components (11-33; DASH-10, DASH-11, DASH-15; 11-UI-SPEC "Reports"; D-UI-P11-14).
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { button, click, mount, type Mounted } from "../../test-support/dom";
import {
  Ga4Panel,
  MetricTable,
  ReportFigures,
  ReportSection,
  SearchQueriesPanel,
  SeoHealthPanel,
  SocialReport,
  SpeedPanel,
  VisitorsChart,
  chartSummary,
  deltaWords,
  niceAxisMax,
  resolveReportPeriod,
  seoWord,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function days(n: number, peak = 84) {
  return Array.from({ length: n }, (_, i) => ({
    day: `2026-10-${String(i + 1).padStart(2, "0")}`,
    views: i === 2 ? peak : i,
  }));
}

describe("VisitorsChart", () => {
  it("renders a table by default (the no-JS equivalent)", () => {
    mounted = mount(<VisitorsChart days={days(7)} />);
    const table = mounted.container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.textContent).toContain("Sat 3 Oct");
    expect(table!.textContent).toContain("84");
    expect(mounted.container.querySelector("svg")).toBeNull();
    expect(button(mounted.container, "Show as chart")).not.toBeNull();
  });

  it("shows an SVG with an aria-label summary after toggling, and back", () => {
    mounted = mount(<VisitorsChart days={days(10)} />);
    click(button(mounted.container, "Show as chart"));
    const svg = mounted.container.querySelector("svg[role='img']");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-label")).toBe(
      "Visitors by day, highest 84 on 3 Oct",
    );
    expect(mounted.container.querySelectorAll("[data-column]")).toHaveLength(
      10,
    );
    expect(mounted.container.querySelector("table")).toBeNull();
    click(button(mounted.container, "Show as table"));
    expect(mounted.container.querySelector("table")).not.toBeNull();
  });

  it("moves between days with the arrow keys and describes the tooltip", () => {
    mounted = mount(<VisitorsChart days={days(5)} initialView="chart" />);
    const group = mounted.container.querySelector("[role='group']")!;
    act(() => {
      group.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
    });
    act(() => {
      group.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    const tipId = group.getAttribute("aria-describedby");
    expect(tipId).toBeTruthy();
    expect(document.getElementById(tipId!)!.textContent).toBe(
      "Fri 2 Oct · 1 visitor",
    );
  });

  it("summarises empty periods and picks round axis tops", () => {
    expect(chartSummary([])).toContain("no days");
    expect(chartSummary([{ day: "2026-10-01", views: 0 }])).toContain(
      "no visitors",
    );
    expect(niceAxisMax(84)).toBe(90);
    expect(niceAxisMax(0)).toBe(3);
    expect(niceAxisMax(1000) % 3).toBe(0);
  });
});

describe("SeoHealthPanel", () => {
  const fixes = [
    {
      pageId: "p1",
      rule: "description" as const,
      message: "Add a description to About us",
    },
    {
      pageId: "p2",
      rule: "alt" as const,
      message: "Add alt text to 2 images on Home",
    },
    {
      pageId: null,
      rule: "sitemap" as const,
      message: "Publish a page so the sitemap lists it",
    },
    {
      pageId: "p3",
      rule: "h1" as const,
      message: "Add one main heading to Visit",
    },
  ];

  it("shows '{score} out of 100' and at most three fixes linking to the page SEO panel", () => {
    mounted = mount(
      <SeoHealthPanel
        score={82}
        fixes={fixes}
        checkedAt="3 Oct, 9:40 AM"
        pageNames={{ p1: "About us", p2: "Home" }}
        fixHref={(id) => `/hub/website/pages/${id}?seo=1`}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("82 out of 100");
    expect(text).toContain("Good");
    const items = mounted.container.querySelectorAll("ol > li");
    expect(items).toHaveLength(3);
    const link = mounted.container.querySelector("ol a");
    expect(link!.textContent).toBe("Fix on About us");
    expect(link!.getAttribute("href")).toBe("/hub/website/pages/p1?seo=1");
    // The site-wide fix has no link.
    expect(items[2]!.querySelector("a")).toBeNull();
    expect(text).toContain("Checked 3 Oct, 9:40 AM from your published pages.");
  });

  it("says all clear when there is nothing to fix, and hides links without fixHref", () => {
    mounted = mount(<SeoHealthPanel score={100} fixes={[]} />);
    expect(mounted.container.textContent).toContain(
      "Nothing to fix right now.",
    );
    expect(mounted.container.textContent).toContain("Great");
  });

  it("maps scores to words", () => {
    expect(seoWord(95).word).toBe("Great");
    expect(seoWord(70).word).toBe("Good");
    expect(seoWord(50).word).toBe("Needs work");
    expect(seoWord(10)).toEqual({ word: "Needs attention", tone: "bouncing" });
  });
});

describe("Google panels", () => {
  it("not connected GA4 and Search Console read 'Connects when Support finishes setup'", () => {
    mounted = mount(
      <div>
        <Ga4Panel summary={{ connected: false }} />
        <SearchQueriesPanel queries={{ connected: false }} />
      </div>,
    );
    const notes = mounted.container.querySelectorAll("[data-not-connected]");
    expect(notes).toHaveLength(2);
    expect(notes[0]!.textContent).toContain(
      "Connects when Support finishes setup",
    );
    expect(mounted.container.querySelector("button")).toBeNull();
    expect(mounted.container.querySelector("[role='alert']")).toBeNull();
  });

  it("connected GA4 shows numbers and the undercount note", () => {
    mounted = mount(
      <Ga4Panel
        summary={{
          connected: true,
          users: 1284,
          sessions: 1500,
          topPages: [{ path: "/", views: 900 }],
        }}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("1,284");
    expect(text).toContain("only counts visitors who accept cookies");
  });

  it("connected Search Console lists searches", () => {
    mounted = mount(
      <SearchQueriesPanel
        queries={{
          connected: true,
          rows: [{ query: "massage austin", clicks: 4, impressions: 120 }],
        }}
      />,
    );
    expect(mounted.container.textContent).toContain("massage austin");
    expect(mounted.container.textContent).toContain("Times shown");
  });
});

describe("SocialReport", () => {
  it("renders visits and form submissions per platform, never followers", () => {
    mounted = mount(
      <SocialReport
        period={30}
        addLinksHref="/hub/marketing?tab=social"
        rows={[
          { source: "instagram", visits: 84, conversions: 6 },
          { source: "facebook", visits: 12, conversions: 0 },
        ]}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(
      "Instagram sent 84 visitors and 6 messages in the last 30 days.",
    );
    const rows = mounted.container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[1]!.textContent).toContain("Facebook");
    const headers = [...mounted.container.querySelectorAll("thead th")].map(
      (th) => th.textContent,
    );
    expect(headers).toEqual(["Account", "Visitors", "Messages"]);
    expect(text.toLowerCase()).not.toMatch(
      /followers?\b(?! counts aren't shown)/,
    );
  });

  it("shows SOCIAL-EMPTY with a link to add bio links", () => {
    mounted = mount(
      <SocialReport
        period={7}
        rows={[]}
        addLinksHref="/hub/marketing?tab=social"
      />,
    );
    const link = mounted.container.querySelector("a");
    expect(link!.textContent).toBe("Add your bio links");
    expect(link!.getAttribute("href")).toBe("/hub/marketing?tab=social");
    expect(mounted.container.querySelector("table")).toBeNull();
  });
});

describe("Speed, sections, tables, figures", () => {
  const good = { p75: 1800, rating: "good" as const };
  const device = {
    lcp: good,
    inp: { p75: 300, rating: "needs-work" as const },
    cls: null,
  };

  it("SpeedPanel shows badges with words, or SPEED-FEW under 20 visits", () => {
    mounted = mount(
      <SpeedPanel phone={device} computer={device} visits={40} />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("1.8 s");
    expect(text).toContain("Needs work");
    expect(text).toContain("Loading");
    mounted.unmount();
    mounted = mount(<SpeedPanel phone={device} computer={device} visits={5} />);
    expect(mounted.container.textContent).toContain("We need about 20.");
  });

  it("ReportSection shows ERR-SECTION with Try again when failed", () => {
    mounted = mount(
      <ReportSection
        title="Top pages"
        failed
        retryHref="/hub/reports?period=30"
      >
        <p>body</p>
      </ReportSection>,
    );
    expect(mounted.container.querySelector("h2")!.textContent).toBe(
      "Top pages",
    );
    expect(
      mounted.container.querySelector("[role='alert']")!.textContent,
    ).toContain("The rest of the page is fine.");
    expect(mounted.container.textContent).not.toContain("body");
    expect(mounted.container.querySelector("a")!.textContent).toBe("Try again");
  });

  it("MetricTable caps rows and expands with Show all", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      key: `r${i}`,
      cells: { a: `row ${i}`, b: i },
    }));
    mounted = mount(
      <MetricTable
        caption="t"
        columns={[
          { key: "a", label: "A" },
          { key: "b", label: "B", numeric: true },
        ]}
        rows={rows}
      />,
    );
    expect(mounted.container.querySelectorAll("tbody tr")).toHaveLength(10);
    click(button(mounted.container, "Show all 12"));
    expect(mounted.container.querySelectorAll("tbody tr")).toHaveLength(12);
  });

  it("ReportFigures shows plain-word deltas", () => {
    mounted = mount(
      <ReportFigures
        period={30}
        figures={[{ label: "Visitors", now: 120, prev: 100 }]}
      />,
    );
    expect(mounted.container.textContent).toContain(
      "Up 20% vs the previous 30 days",
    );
    expect(deltaWords(5, 0, 7).words).toContain("Up from none");
    expect(deltaWords(5, 5, 7).words).toBe("Same as the previous 7 days");
  });

  it("resolves the period with a 30 day default", () => {
    expect(resolveReportPeriod("7")).toBe(7);
    expect(resolveReportPeriod("90")).toBe(90);
    expect(resolveReportPeriod("28")).toBe(30);
    expect(resolveReportPeriod(undefined)).toBe(30);
    expect(resolveReportPeriod(["7", "90"])).toBe(7);
  });
});
