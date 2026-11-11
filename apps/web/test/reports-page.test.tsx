// @vitest-environment jsdom
// 11-33 Task 2: /hub/reports (DASH-10, DASH-11, DASH-15, DASH-25, DASH-32; 11-UI-SPEC
// "Reports"; T-11-33-01, T-11-33-02). The real server page over a mocked session and
// @cds/db; unstable_cache is a pass-through that records its keys and tags.
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/reports",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

const cache = vi.hoisted(() => ({
  calls: [] as { key: string[]; tags: string[]; revalidate: number }[],
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  unstable_cache:
    (
      fn: () => Promise<unknown>,
      key: string[],
      opts: { tags: string[]; revalidate: number },
    ) =>
    () => {
      cache.calls.push({ key, tags: opts.tags, revalidate: opts.revalidate });
      return fn();
    },
}));

const ROLES = {
  owner: { orgId: "org1", actor: "u1", role: "owner", grants: [] },
  viewer: { orgId: "org1", actor: "u3", role: "viewer", grants: [] },
} as const;

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  getOrgStage: vi.fn(),
  listPages: vi.fn(),
  liveTag: (id: string) => `org:${id}:live`,
  readGa4Summary: vi.fn(),
  readSearchTopQueries: vi.fn(),
  readSiteStats: vi.fn(),
  seoHealthFor: vi.fn(),
  socialSourceStats: vi.fn(),
  statsTimeZone: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const { default: ReportsPage } =
  await import("../app/(platform)/hub/reports/page");
const { default: ReportsLoading } =
  await import("../app/(platform)/hub/reports/loading");
const { periodRanges, reportsTag } =
  await import("../app/(platform)/hub/reports/report-data");

const NONE = { lcp: null, inp: null, cls: null };

function stats(views: number) {
  return {
    views,
    byDay: [
      { day: "2026-10-10", views: Math.floor(views / 2) },
      { day: "2026-10-11", views: views - Math.floor(views / 2) },
    ],
    topPages: [
      { path: "/", views: Math.floor(views / 2) },
      { path: "/about", views: 10 },
    ],
    sources: [
      { source: "google", kind: "search", views: 40, conversions: 2 },
      { source: "instagram", kind: "social", views: 20, conversions: 1 },
    ],
    notFound: [{ path: "/old-page", hits: 3, lastSeen: "2026-10-09" }],
    vitals: NONE,
    vitalsByDevice: {
      m: {
        lcp: { p75: 2100, rating: "good", samples: 30 },
        inp: { p75: 150, rating: "good", samples: 30 },
        cls: { p75: 0.05, rating: "good", samples: 30 },
      },
      t: NONE,
      c: NONE,
    },
    formSubmissions: 23,
  };
}

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

beforeEach(() => {
  vi.clearAllMocks();
  cache.calls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  sess.requireHubSession.mockResolvedValue({ ctx: ROLES.owner });
  db.getOrgStage.mockResolvedValue({
    stage: "live",
    path: "standard",
    slug: "x",
  });
  db.statsTimeZone.mockResolvedValue("America/Chicago");
  db.listPages.mockResolvedValue([
    { id: "p1", slug: "home", title: "Home" },
    { id: "p2", slug: "about", title: "About us" },
  ]);
  // The current period is read first, the previous one second (date-independent).
  let statCalls = 0;
  db.readSiteStats.mockImplementation(async () =>
    stats(statCalls++ === 0 ? 1284 : 1000),
  );
  db.seoHealthFor.mockResolvedValue({
    score: 82,
    fixes: [
      {
        pageId: "p2",
        rule: "description",
        message: "Add a description to About us",
      },
    ],
    pages: 2,
    checkedAt: "2026-10-11 14:40:00.000Z",
  });
  db.readGa4Summary.mockResolvedValue({ connected: false });
  db.readSearchTopQueries.mockResolvedValue({ connected: false });
  db.socialSourceStats.mockResolvedValue([
    { source: "instagram", visits: 84, conversions: 6 },
  ]);
});

async function render(sp: Record<string, string> = {}) {
  const el = (await ReportsPage({
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  mounted = mount(el);
  return mounted.container;
}

function headings(root: Element): string[] {
  return [...root.querySelectorAll("h2")].map((h) => h.textContent ?? "");
}

describe("/hub/reports", () => {
  it("live org: Site Report sections render with stats, in order", async () => {
    const root = await render();
    expect(root.querySelector("h1")!.textContent).toBe("Reports");
    expect(headings(root)).toEqual([
      "Summary",
      "Visitors by day",
      "Top pages",
      "Where visitors come from",
      "SEO health",
      "Page speed",
      "Messages from your forms",
      "Pages not found",
      "What people searched on Google",
      "Google Analytics",
    ]);
    const text = root.textContent ?? "";
    expect(text).toContain(
      "In the last 30 days, 1,284 people visited your site and 23 sent you a message.",
    );
    expect(text).toContain("Up 28% vs the previous 30 days");
    expect(text).toContain("About us");
    expect(text).toContain("Instagram");
    expect(text).toContain("82 out of 100");
    expect(text).toContain("/old-page");
    expect(text).toContain("2.1 s");
    // Not connected Google sections (DASH-10).
    expect(root.querySelectorAll("[data-not-connected]")).toHaveLength(2);
    expect(text).toContain("Connects when CDS finishes setup");
    // The chart starts as its table (no-JS default).
    expect(root.textContent).toContain("Show as chart");
    // Fix link to the page's SEO drawer for an editor-capable member.
    const fix = [...root.querySelectorAll("a")].find(
      (a) => a.textContent === "Fix on About us",
    );
    expect(fix!.getAttribute("href")).toBe("/hub/website/pages/p2?seo=1");
  });

  it("tabs come from HUB_SECTIONS with ?tab= links; Site Report is active by default", async () => {
    const root = await render();
    const tabs = root.querySelector("nav[aria-label='Reports sections']")!;
    const links = [...tabs.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(["Site Report", "Social"]);
    expect(links[0]!.getAttribute("aria-current")).toBe("page");
    expect(links[1]!.getAttribute("href")).toBe("?tab=social&period=30");
    const help = root.querySelector("a[aria-label^='How']");
    expect(help!.getAttribute("href")).toContain("reports.site");
  });

  it("unknown tab falls back to Site Report", async () => {
    const root = await render({ tab: "nope" });
    expect(headings(root)).toContain("Summary");
  });

  it("?tab=social renders the Social tab, no followers", async () => {
    const root = await render({ tab: "social", period: "7" });
    const text = root.textContent ?? "";
    expect(text).toContain(
      "Instagram sent 84 visitors and 6 messages in the last 7 days.",
    );
    expect(headings(root)).toEqual(["Visits from social"]);
    expect(db.readSiteStats).not.toHaveBeenCalled();
    const active = root.querySelector(
      "nav[aria-label='Report period'] a[aria-current='true']",
    );
    expect(active!.textContent).toBe("Last 7 days");
  });

  it("pre-launch org: first-numbers note, SEO health still shows, no traffic reads", async () => {
    db.getOrgStage.mockResolvedValue({
      stage: "being_built",
      path: "standard",
      slug: "x",
    });
    const root = await render();
    const text = root.textContent ?? "";
    expect(text).toContain("Your first numbers appear a day after launch.");
    expect(text).toContain("82 out of 100");
    expect(text).toContain(
      "Speed is measured from real visitors, so it shows after launch.",
    );
    expect(headings(root)).not.toContain("Visitors by day");
    expect(root.querySelector("svg[role='img']")).toBeNull();
    expect(db.readSiteStats).not.toHaveBeenCalled();
  });

  it("pre-launch Social tab shows SOCIAL-PRELAUNCH", async () => {
    db.getOrgStage.mockResolvedValue({ stage: "intake", path: "", slug: "x" });
    const root = await render({ tab: "social" });
    expect(root.textContent).toContain(
      "Visits from your bio links show here after launch.",
    );
    expect(db.socialSourceStats).not.toHaveBeenCalled();
  });

  it("a failing stats read shows the section error only", async () => {
    db.readSiteStats.mockRejectedValue(new Error("boom"));
    const root = await render();
    const alerts = root.querySelectorAll("[role='alert']");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]!.textContent).toContain("The rest of the page is fine.");
    // SEO health still renders.
    expect(root.textContent).toContain("82 out of 100");
  });

  it("a failing SEO read only breaks SEO health", async () => {
    db.seoHealthFor.mockRejectedValue(new Error("boom"));
    const root = await render();
    expect(root.querySelectorAll("[role='alert']")).toHaveLength(1);
    expect(root.textContent).toContain("1,284 people");
  });

  it("Viewer can open Reports (no fix links)", async () => {
    sess.requireHubSession.mockResolvedValue({ ctx: ROLES.viewer });
    const root = await render();
    expect(root.querySelector("h1")!.textContent).toBe("Reports");
    expect(root.textContent).toContain("Add a description to About us");
    expect(
      [...root.querySelectorAll("a")].some((a) =>
        a.textContent?.startsWith("Fix on"),
      ),
    ).toBe(false);
  });

  it("a member without content read gets a 404", async () => {
    sess.requireHubSession.mockResolvedValue({
      ctx: { orgId: "org1", actor: "u9", role: "renter", grants: [] },
    });
    await expect(
      ReportsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("caches stats per org and period under org:<id>:reports for 10 minutes", async () => {
    await render({ period: "90" });
    const stat = cache.calls.find((c) => c.key[0] === "reports-stats")!;
    expect(stat.key[1]).toBe("org1");
    expect(stat.tags).toEqual([reportsTag("org1")]);
    expect(stat.revalidate).toBe(600);
    const seo = cache.calls.find((c) => c.key[0] === "reports-seo")!;
    expect(seo.tags).toContain("org:org1:live");
    const ranges = db.readSiteStats.mock.calls.map(
      (c) => c[1] as { from: string; to: string },
    );
    expect(ranges).toHaveLength(2);
    expect(db.readSiteStats.mock.calls[0]![0]).toBe(ROLES.owner);
  });

  it("periods are business days ending today with an equal previous span", () => {
    const now = new Date("2026-10-11T03:00:00Z"); // 10 Oct, 22:00 in Chicago
    expect(periodRanges(now, "America/Chicago", 7)).toEqual({
      current: { from: "2026-10-04", to: "2026-10-10" },
      previous: { from: "2026-09-27", to: "2026-10-03" },
    });
  });

  it("loading state keeps the H1 and shows section skeletons", () => {
    mounted = mount(<ReportsLoading />);
    expect(mounted.container.querySelector("h1")!.textContent).toBe("Reports");
    expect(
      mounted.container.querySelector("[aria-busy='true']"),
    ).not.toBeNull();
  });
});
