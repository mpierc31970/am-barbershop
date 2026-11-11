// 13-25 (STAFF-05, STAFF-06; P13-P23, P13-P33; T-13-25-01, T-13-25-02): the console frame.
// Signed out -> sign-in with `next`; role-filtered nav (Settings absent for support agents);
// `?tab=` parsed against STAFF_SECTIONS (unknown -> first tab); a malformed org id is a 404;
// every tab has an owned panel stub; /staff is noindex (middleware header, robots.txt) while a
// tenant's own /staff page is not; the sign-in referrer guard re-navigates once.
// readStaffSession is mocked; staffGetSite is the real one (a malformed id fails before any read).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { STAFF_TAB_IDS } from "@cds/core/staff";
import { NextRequest } from "next/server";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { kit, nextSignal, resetStaffKit } from "./staff-test-kit";

vi.mock(
  "next/headers",
  async () => (await import("./staff-test-kit")).nextHeadersMock,
);
vi.mock(
  "next/navigation",
  async () => (await import("./staff-test-kit")).nextNavigationMock,
);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

const db = vi.hoisted(() => ({
  readStaffSession: vi.fn(),
  isHostSuspended: vi.fn(async () => false),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const STAFF = "app/(platform)/staff";
const CONSOLE = `${STAFF}/(console)`;
const WEB = path.resolve(import.meta.dirname, "..");

const sections = await import("../app/(platform)/staff/sections");
const { default: Layout } =
  await import("../app/(platform)/staff/(console)/layout");
const { default: TicketsPage } =
  await import("../app/(platform)/staff/(console)/tickets/page");
const { default: PipelinePage } =
  await import("../app/(platform)/staff/(console)/pipeline/page");
const { default: SettingsPage } =
  await import("../app/(platform)/staff/(console)/settings/page");
const { default: SitePage } =
  await import("../app/(platform)/staff/(console)/sites/[org]/page");
const { default: TodayPage } =
  await import("../app/(platform)/staff/(console)/page");
const { middleware } = await import("../middleware");
const robots = await import("../app/(platform)/robots.txt/route");
const { crossSiteRenavHref } =
  await import("../app/(platform)/staff/sign-in/StaffSignInForm");

type Role = "super_admin" | "support_agent";

function signIn(role: Role) {
  kit.cookies.set("cds_staff", "tok");
  db.readStaffSession.mockResolvedValue({
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    sessionId: "sess00000000001",
    stepUpFresh: true,
    staffName: role === "super_admin" ? "Sam Admin" : "Mara Agent",
    staffEmailMasked: "s•••@example.test",
    createdAt: "2026-10-15T10:00:00.000Z",
  });
}

async function html(el: Promise<ReactElement> | ReactElement): Promise<string> {
  return renderToStaticMarkup(await el);
}

beforeEach(() => {
  resetStaffKit();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PLATFORM_HOSTS", "cds.needtobeedgy.com");
});

describe("console guard", () => {
  it("signed out: /staff/tickets redirects to sign-in with next", async () => {
    kit.headers["x-cds-path"] = "/staff/tickets";
    const sig = await nextSignal(() => TicketsPage({}));
    expect(sig).toBe("NEXT_REDIRECT:/staff/sign-in?next=%2Fstaff%2Ftickets");
    expect(await nextSignal(() => Layout({ children: null }))).toBe(
      "NEXT_REDIRECT:/staff/sign-in?next=%2Fstaff%2Ftickets",
    );
  });

  it("support_agent: 7 nav items without Settings; /staff/settings is a 404", async () => {
    signIn("support_agent");
    const nav = sections.staffNav("support_agent", "tickets");
    expect(nav.map((n) => n.key)).toEqual([
      "today",
      "tickets",
      "pipeline",
      "review",
      "sites",
      "catalog",
      "health",
    ]);
    expect(nav.find((n) => n.current)?.key).toBe("tickets");
    expect(await nextSignal(() => SettingsPage({}))).toBe("NEXT_NOT_FOUND");
    const out = await html(Layout({ children: "body" }));
    expect(out).toContain('aria-label="Staff console"');
    expect(out).not.toContain(">Settings<");
    expect(out).toContain("Support agent");
    expect(out).toContain("data-cds-identity");
  });

  it("super_admin: 8 nav items in the fixed order, Super Admin label", async () => {
    signIn("super_admin");
    expect(sections.staffNav("super_admin", null).map((n) => n.label)).toEqual([
      "Today",
      "Tickets",
      "Pipeline",
      "Review queue",
      "Sites",
      "Catalog",
      "Health",
      "Settings",
    ]);
    const out = await html(Layout({ children: "body" }));
    const order = [
      "Today",
      "Tickets",
      "Pipeline",
      "Review queue",
      "Sites",
      "Catalog",
      "Health",
      "Settings",
    ].map((l) => out.indexOf(`>${l}<`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain("Super Admin");
    expect(await html(SettingsPage({}))).toContain(">Settings</h1>");
  });
});

describe("tabs", () => {
  it("parseStaffTab: unknown or missing -> first tab", () => {
    expect(sections.parseStaffTab("pipeline", "bogus")).toBe("leads");
    expect(sections.parseStaffTab("pipeline", undefined)).toBe("leads");
    expect(sections.parseStaffTab("pipeline", ["polish"])).toBe("polish");
    expect(sections.parseStaffTab("tickets", "ratings")).toBe("ratings");
  });

  it("/staff/pipeline?tab=bogus renders Leads as the current tab", async () => {
    signIn("support_agent");
    const out = await html(
      PipelinePage({ searchParams: Promise.resolve({ tab: "bogus" }) }),
    );
    expect(out).toMatch(/aria-current="page"[^>]*>Leads</);
    expect(out).toContain(">Pipeline</h1>");
    expect(out).toContain('href="/staff/pipeline?tab=fit"');
  });

  it("STAFF_SECTIONS tab ids match @cds/core/staff STAFF_TAB_IDS", () => {
    for (const [key, ids] of Object.entries(STAFF_TAB_IDS)) {
      const def = sections.STAFF_SECTIONS[key as keyof typeof STAFF_TAB_IDS];
      expect(def.tabs.map((t) => t.id)).toEqual([...ids]);
    }
  });

  it("every tab has an owned panel stub (P13-P23)", () => {
    for (const [key, ids] of Object.entries(STAFF_TAB_IDS)) {
      const dir =
        key === "sites"
          ? `${CONSOLE}/sites/[org]/panels`
          : `${CONSOLE}/${key}/panels`;
      for (const id of ids) {
        const file = path.join(WEB, dir, `${id}.tsx`);
        expect(existsSync(file), file).toBe(true);
        expect(readFileSync(file, "utf8")).toMatch(
          /^\/\/ Panel .+: filled by 1[34]-\d\d/,
        );
      }
    }
    for (const f of ["panels/today.tsx", "sites/panels/list.tsx"]) {
      expect(existsSync(path.join(WEB, CONSOLE, f))).toBe(true);
    }
  });

  it("Find's Screens index lists areas and tabs the role may open", () => {
    const agent = sections.staffScreensIndex("support_agent");
    expect(agent.some((e) => e.href === "/staff/settings")).toBe(false);
    expect(agent).toContainEqual({
      group: "Screens",
      label: "Fit holds",
      href: "/staff/pipeline?tab=fit",
      path: "Pipeline › Fit holds",
    });
    expect(
      sections
        .staffScreensIndex("super_admin")
        .some((e) => e.href === "/staff/settings?tab=demo"),
    ).toBe(true);
  });

  it("no role literals in the staff route tree", () => {
    const files = [
      `${STAFF}/sections.ts`,
      `${CONSOLE}/layout.tsx`,
      `${CONSOLE}/StaffAreaPage.tsx`,
      `${CONSOLE}/StaffChrome.tsx`,
    ];
    for (const f of files) {
      expect(readFileSync(path.join(WEB, f), "utf8")).not.toMatch(
        /"super_admin"|"support_agent"/,
      );
    }
  });
});

describe("site detail and Today", () => {
  it("/staff/sites/not-an-id is a 404", async () => {
    signIn("support_agent");
    const sig = await nextSignal(() =>
      SitePage({ params: Promise.resolve({ org: "not-an-id" }) }),
    );
    expect(sig).toBe("NEXT_NOT_FOUND");
  });

  it("Today renders its H1 for any console role", async () => {
    signIn("support_agent");
    expect(await html(TodayPage({}))).toContain(">Today</h1>");
  });
});

describe("noindex (P13-P33)", () => {
  function req(url: string, host: string) {
    return new NextRequest(url, { headers: { host } });
  }

  it("platform /staff responses carry X-Robots-Tag noindex, nofollow", async () => {
    for (const p of ["/staff", "/staff/tickets", "/staff/sign-in"]) {
      const res = await middleware(
        req(`http://cds.needtobeedgy.com${p}`, "cds.needtobeedgy.com"),
      );
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
    const hub = await middleware(
      req("http://cds.needtobeedgy.com/staffing", "cds.needtobeedgy.com"),
    );
    expect(hub.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("a tenant's own /staff page is not noindexed", async () => {
    const res = await middleware(
      req("http://acme-yoga.com/staff", "acme-yoga.com"),
    );
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      "/tenant/acme-yoga.com/staff",
    );
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  // 15-22 choice 3: robots.txt is per environment; /staff is disallowed in both.
  it("platform robots.txt disallows /staff", async () => {
    vi.stubEnv("CDS_ENV", "production");
    const res: Response = robots.GET();
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toContain("\nDisallow: /staff\n");
    vi.stubEnv("CDS_ENV", "dev");
    expect(await robots.GET().text()).toBe("User-agent: *\nDisallow: /\n");
    vi.unstubAllEnvs();
  });
});

describe("sign-in referrer guard (RESEARCH Pitfall 2)", () => {
  const here =
    "https://cds.needtobeedgy.com/staff/sign-in?next=%2Fstaff%2Ftickets%2F1042";

  it("re-navigates once when the referrer is cross-site", () => {
    const to = crossSiteRenavHref("https://mail.google.com/", here);
    expect(to).not.toBeNull();
    const u = new URL(to!);
    expect(u.origin).toBe("https://cds.needtobeedgy.com");
    expect(u.searchParams.get("r")).toBe("1");
    expect(u.searchParams.get("next")).toBe("/staff/tickets/1042");
    expect(crossSiteRenavHref("https://mail.google.com/", to!)).toBeNull();
  });

  it("does nothing for same-origin, empty or malformed referrers", () => {
    expect(
      crossSiteRenavHref("https://cds.needtobeedgy.com/staff/tickets", here),
    ).toBeNull();
    expect(crossSiteRenavHref("", here)).toBeNull();
    expect(crossSiteRenavHref("not a url", here)).toBeNull();
  });

  it("the sign-in page is noindex and points owners to /sign-in", async () => {
    const mod = await import("../app/(platform)/staff/sign-in/page");
    expect(mod.metadata.robots).toEqual({ index: false, follow: false });
    const out = await html(mod.default({}));
    expect(out).toContain(">Website admin</h1>");
    expect(out).toContain('href="/sign-in"');
    expect(out).toContain("am-signin");
  });

  it("a signed-in staff member is sent on to a safe next", async () => {
    signIn("support_agent");
    const mod = await import("../app/(platform)/staff/sign-in/page");
    expect(
      await nextSignal(() =>
        mod.default({
          searchParams: Promise.resolve({ next: "https://evil.example/x" }),
        }),
      ),
    ).toBe("NEXT_REDIRECT:/staff");
    expect(
      await nextSignal(() =>
        mod.default({
          searchParams: Promise.resolve({ next: "/staff/review" }),
        }),
      ),
    ).toBe("NEXT_REDIRECT:/staff/review");
  });
});
