// 12-14 Task 2 (COMM-11, COMM-05, D99-D101; 12-UI-SPEC lines 564-582; RESEARCH Pitfall 12,
// Open Q2): the hub layout reads the service notices once (with the nav's active add-on list)
// and HubShell renders the strip under the top bar on every reached screen, in the builder
// too; a failing notice read renders the page with no strip (T-12-14-02).
import type { ServiceNotice } from "@cds/core/support";
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/hub/today", search: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "x-cds-path": state.pathname }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

const db = vi.hoisted(() => ({
  listNeedsYou: vi.fn(async () => ({ items: [], failed: [] })),
  activeAddons: vi.fn(async () => ["events"] as string[]),
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
  activeServiceNotices: vi.fn(),
  getBusinessProfile: vi.fn(async () => ({ time_zone: "America/Denver" })),
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
  orgs: [{ id: "orgaaaaaaaaaaa1", name: "Rivera Bakery", role: "owner" }],
  staleOrg: false,
};
vi.mock("../lib/session", async (orig) => ({
  ...(await orig<typeof import("../lib/session")>()),
  getDeclinedSession: async () => null,
  getHubSession: async () => SESSION,
  requireHubSession: async () => SESSION,
}));

const { default: HubLayout } = await import("../app/(platform)/hub/layout");

const ACTIVE: ServiceNotice = {
  id: "w1aaaaaaaaaaaa1",
  code: "W-1",
  phase: "active",
  text: "CDS is working on your site until 4:00 pm.",
  message: "",
  startsAt: "2026-10-12T17:00:00Z",
  endsAt: "2026-10-12T21:00:00Z",
  incident: null,
  dismissible: false,
  reach: { scope: "everywhere" },
};
const PLANNED: ServiceNotice = {
  ...ACTIVE,
  id: "w2aaaaaaaaaaaa2",
  code: "W-2",
  phase: "upcoming",
  text: "Planned work on your site Tue 13 Oct, 9:00–11:00 pm.",
  dismissible: true,
};
const PAGE: ServiceNotice = {
  ...ACTIVE,
  id: "w3aaaaaaaaaaaa3",
  code: "W-3",
  text: "CDS is working on your About us page until 4:00 pm.",
  reach: { scope: "page", page: "p1" },
};

async function render(): Promise<string> {
  return renderToStaticMarkup(
    (await HubLayout({
      children: createElement("p", null, "inner"),
    })) as ReactElement,
  );
}

/** Index of the strip vs the main landmark: the strip sits above <main>. */
function stripBeforeMain(html: string): boolean {
  const strip = html.indexOf('aria-label="Notices from CDS"');
  const main = html.indexOf('id="hub-main"');
  return strip >= 0 && main > strip;
}

beforeEach(() => {
  state.pathname = "/hub/today";
  state.search = "";
  db.activeServiceNotices.mockReset();
  db.activeAddons.mockClear();
  db.getBusinessProfile.mockClear();
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
      (k as ReactElement<Record<string, unknown>>).props.notices !== undefined,
  ) as ReactElement<Record<string, unknown>>;
  return shell.props;
}

describe("hub notice strip (COMM-11)", () => {
  it("renders the active and planned strips on Today, with the nav's add-on list", async () => {
    db.activeServiceNotices.mockResolvedValue([ACTIVE, PLANNED]);
    const html = await render();
    expect(stripBeforeMain(html)).toBe(true);
    expect(html).toContain('role="status"');
    expect(html).toContain("CDS is working on your site until 4:00 pm.");
    expect(html).toContain("Planned work on your site");
    expect(html).toContain('aria-label="Dismiss this notice"');
    expect(html).toContain("<p>inner</p>");
    expect(db.activeServiceNotices).toHaveBeenCalledTimes(1);
    const opts = db.activeServiceNotices.mock.calls[0]![1] as {
      activeAddons: string[];
      addonNames: Record<string, string>;
    };
    expect(opts.activeAddons).toEqual(["events"]);
  });

  it("renders the strip on Settings", async () => {
    state.pathname = "/hub/settings";
    db.activeServiceNotices.mockResolvedValue([ACTIVE]);
    const html = await render();
    expect(stripBeforeMain(html)).toBe(true);
    expect(html).toContain("CDS is working on your site until 4:00 pm.");
  });

  it("a page notice stays off other screens", async () => {
    db.activeServiceNotices.mockResolvedValue([PAGE]);
    const html = await render();
    expect(html).not.toContain("About us page");
    expect(html).not.toContain('aria-label="Notices from CDS"');
  });

  it("builder mode renders the strip (page notice on its own builder)", async () => {
    state.pathname = "/hub/website/pages/p1";
    db.activeServiceNotices.mockResolvedValue([PAGE, ACTIVE]);
    const html = await render();
    expect(stripBeforeMain(html)).toBe(true);
    expect(html).toContain("CDS is working on your About us page");
    expect(html).toContain("CDS is working on your site until 4:00 pm.");
  });

  it("a throwing notice read renders the page and no strip", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.activeServiceNotices.mockRejectedValue(new TypeError("pb down"));
    const html = await render();
    expect(html).toContain("<p>inner</p>");
    expect(html).toContain('aria-label="Hub"');
    expect(html).not.toContain('aria-label="Notices from CDS"');
    expect(err).toHaveBeenCalledWith(
      "[hub] service notices failed",
      "TypeError",
    );
    err.mockRestore();
  });

  it("bare preview shows no strip", async () => {
    state.pathname = "/hub/website/pages/p1/preview";
    db.activeServiceNotices.mockResolvedValue([ACTIVE]);
    const html = await render();
    expect(html).not.toContain('aria-label="Notices from CDS"');
  });

  it("IN-C01: the strip gets the business's own time zone", async () => {
    db.activeServiceNotices.mockResolvedValue([ACTIVE]);
    expect((await shellProps()).timeZone).toBe("America/Denver");
  });

  it("IN-C01: an unreadable profile falls back to UTC; no notice, no read", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.activeServiceNotices.mockResolvedValue([ACTIVE]);
    db.getBusinessProfile.mockRejectedValueOnce(new TypeError("pb down"));
    expect((await shellProps()).timeZone).toBe("UTC");
    err.mockRestore();
    db.getBusinessProfile.mockClear();
    db.activeServiceNotices.mockResolvedValue([]);
    await shellProps();
    expect(db.getBusinessProfile).not.toHaveBeenCalled();
  });
});
