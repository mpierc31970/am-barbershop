// 11-16 Task 1 (DASH-01, DASH-18, DASH-24, DASH-27, DASH-28): the hub layout computes the
// Needs-you list once per request and feeds the sidebar badges from it, passes the person's
// sites, the Jump to index and the profile head to HubShell as plain data, and still
// renders the hub (with no badges) when the Needs-you read fails.
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/hub/today" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "x-cds-path": state.pathname }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

const db = vi.hoisted(() => ({
  listNeedsYou: vi.fn(),
  activeAddons: vi.fn(async () => [] as string[]),
  pausedAddons: vi.fn(async () => [] as string[]),
  getOrgStage: vi.fn(async () => ({ stage: "live", path: "standard" })),
  readBillingAccount: vi.fn(async () => ({
    status: "active",
    amountDueCents: 0,
    restoredAt: null,
  })),
  readDeclinedNotice: vi.fn(),
  countSubmissions: vi.fn(async () => ({ unread: 0, filtered: 0 })),
  bellCounts: vi.fn(async () => ({ unread: 0, urgent: 0 })),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const CTX: Record<string, unknown> = {
  orgId: "orgaaaaaaaaaaa1",
  actor: "u1",
  role: "owner",
  grants: [],
  ip: "",
};
const SESSION = {
  ctx: CTX,
  email: "ana@rivera.example",
  org: { id: "orgaaaaaaaaaaa1", name: "Rivera Bakery", primaryHost: null },
  orgs: [
    { id: "orgaaaaaaaaaaa1", name: "Rivera Bakery", role: "owner" },
    { id: "orgbbbbbbbbbbb2", name: "Rivera Catering", role: "editor" },
  ],
  staleOrg: false,
};
vi.mock("../lib/session", async (orig) => ({
  ...(await orig<typeof import("../lib/session")>()),
  getDeclinedSession: async () => null,
  getHubSession: async () => SESSION,
  requireHubSession: async () => SESSION,
}));

const { default: HubLayout } = await import("../app/(platform)/hub/layout");

function item(over: Record<string, unknown> = {}) {
  return {
    key: "billing:fix_card",
    kind: "billing",
    level: "urgent",
    title: "Fix your card",
    actionLabel: "Update card",
    href: "/hub/settings?tab=billing",
    section: "settings",
    tab: "billing",
    at: "2026-10-11T00:00:00.000Z",
    ...over,
  };
}

async function render(): Promise<string> {
  return renderToStaticMarkup(
    (await HubLayout({
      children: createElement("p", null, "inner"),
    })) as ReactElement,
  );
}

/** The sidebar link for one href (desktop aside copy). */
function row(html: string, href: string): string {
  const m = new RegExp(`<a[^>]*href="${href}"[^>]*>(.*?)</a>`).exec(html);
  return m?.[1] ?? "";
}

beforeEach(() => {
  db.listNeedsYou.mockReset();
  state.pathname = "/hub/today";
});

describe("hub layout: one Needs-you call (DASH-27)", () => {
  it("calls listNeedsYou exactly once per render and badges Settings from it", async () => {
    db.listNeedsYou.mockResolvedValue({
      items: [item(), item({ key: "email:r1", tab: "email" })],
      failed: [],
    });
    const html = await render();
    expect(db.listNeedsYou).toHaveBeenCalledTimes(1);
    expect(row(html, "/hub/settings")).toContain(">2<");
    expect(row(html, "/hub/settings")).toContain("need you");
    expect(html).toContain("<p>inner</p>");
  });

  it("Inbox badge comes from the same list; ten or more read 9+", async () => {
    const inbox = Array.from({ length: 12 }, (_, i) =>
      item({
        key: `inbox:m${i}`,
        kind: "inbox",
        level: "normal",
        href: `/hub/inbox?tab=messages&message=m${i}`,
        section: "inbox",
        tab: "messages",
      }),
    );
    db.listNeedsYou.mockResolvedValue({ items: inbox, failed: [] });
    const html = await render();
    expect(db.listNeedsYou).toHaveBeenCalledTimes(1);
    expect(db.countSubmissions).not.toHaveBeenCalled();
    expect(row(html, "/hub/inbox")).toContain("9+");
    expect(row(html, "/hub/inbox")).toContain("unread");
  });

  it("a failed provider omits only its section's badge", async () => {
    db.listNeedsYou.mockResolvedValue({ items: [item()], failed: ["inbox"] });
    const html = await render();
    expect(row(html, "/hub/settings")).toContain(">1<");
    expect(row(html, "/hub/inbox")).not.toContain("unread");
  });

  it("a throwing Needs-you read still renders the hub, with no badges", async () => {
    db.listNeedsYou.mockRejectedValue(new Error("pb down"));
    const html = await render();
    expect(html).toContain("<p>inner</p>");
    expect(html).toContain('aria-label="Hub"');
    expect(html).not.toContain("need you");
    expect(html).not.toContain("unread");
  });
});

describe("hub layout: header props (DASH-18, DASH-28)", () => {
  it("renders the switcher for two sites and the profile menu, not the sidebar email", async () => {
    db.listNeedsYou.mockResolvedValue({ items: [], failed: [] });
    const html = await render();
    expect(html).toContain("Switch site, current: Rivera Bakery");
    expect(html).toContain("Your profile and sign out");
    expect(html).toContain("Jump to a screen or help article");
    expect(html).not.toContain("ana@rivera.example");
    // D311 sidebar order with the P11 items and their icons.
    const order = ["/hub/today", "/hub/inbox", "/hub/website", "/hub/reports"];
    const at = order.map((h) => html.indexOf(`href="${h}"`));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(row(html, "/hub/today")).toContain("<svg");
    expect(row(html, "/hub/reports")).toContain("<svg");
    expect(row(html, "/hub/help")).toContain("<svg");
    // A&M fork: no CDS Support row.
    expect(html).not.toContain('href="/hub/support"');
  });
});

describe("hub layout: bell (11-21; DASH-34)", () => {
  it("seeds the top-bar bell from bellCounts with the Needs-you keys", async () => {
    db.listNeedsYou.mockResolvedValue({
      items: [item()],
      failed: ["inbox"],
    });
    db.bellCounts.mockResolvedValueOnce({ unread: 2, urgent: 1 });
    const html = await render();
    expect(html).toContain('aria-label="Alerts, 2 unread, 1 urgent"');
    const keys = (
      db.bellCounts.mock.calls.at(-1) as unknown as [
        unknown,
        ReadonlySet<string>,
      ]
    )[1];
    expect(keys.has("billing:fix_card")).toBe(true);
    // The failed inbox provider's alerts never clear.
    expect(keys.has("inbox:any")).toBe(true);
  });

  it("a failed count shows the bell at zero; impersonating staff get no bell", async () => {
    db.listNeedsYou.mockResolvedValue({ items: [], failed: [] });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.bellCounts.mockRejectedValueOnce(new Error("pb down"));
    let html = await render();
    expect(html).toContain('aria-label="Alerts"');
    err.mockRestore();
    CTX.impersonator = "staffaaaaaaaaa1";
    try {
      db.bellCounts.mockClear();
      html = await render();
      expect(html).not.toContain('aria-label="Alerts');
      expect(db.bellCounts).not.toHaveBeenCalled();
    } finally {
      delete CTX.impersonator;
    }
  });
});

/** The HubShell element's props (the layout's tree is ToastRegion > [HubShell, toast]). */
async function shellProps(): Promise<Record<string, unknown>> {
  const tree = (await HubLayout({
    children: createElement("p", null, "inner"),
  })) as ReactElement<{ children: ReactNode }>;
  const kids = ([] as ReactNode[]).concat(tree.props.children);
  const shell = kids.find(
    (k) =>
      typeof k === "object" &&
      k !== null &&
      "props" in k &&
      (k as ReactElement<Record<string, unknown>>).props.jumpIndex !==
        undefined,
  ) as ReactElement<Record<string, unknown>>;
  return shell.props;
}

describe("hub layout: help in Jump to (11-46; DASH-28)", () => {
  type Entry = { group: string; label: string; href: string };

  it("lists the help articles the Owner may read after the screens", async () => {
    db.listNeedsYou.mockResolvedValue({ items: [], failed: [] });
    const jump = (await shellProps()).jumpIndex as Entry[];
    const help = jump.filter((e) => e.group === "Help articles");
    expect(help.length).toBeGreaterThan(40);
    expect(help.every((e) => e.href.startsWith("/hub/help/"))).toBe(true);
    expect(help.some((e) => e.href === "/hub/help/billing")).toBe(true);
    // Live site: no "Getting set up" articles.
    expect(help.some((e) => e.href === "/hub/help/checkout")).toBe(false);
    expect(jump.findIndex((e) => e.group === "Help articles")).toBeGreaterThan(
      jump.map((e) => e.group).lastIndexOf("Screens"),
    );
  });

  it("a Viewer's Jump to has no owner-only articles", async () => {
    db.listNeedsYou.mockResolvedValue({ items: [], failed: [] });
    CTX.role = "viewer";
    try {
      const jump = (await shellProps()).jumpIndex as Entry[];
      const hrefs = jump.map((e) => e.href);
      expect(hrefs).toContain("/hub/help/today");
      for (const id of [
        "billing",
        "download-data",
        "add-pages",
        "people-roles",
      ])
        expect(hrefs).not.toContain(`/hub/help/${id}`);
    } finally {
      CTX.role = "owner";
    }
  });
});
