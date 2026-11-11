// 07-25 Task 1: menu / footer actions and the Add page menu hook (CONT-13; T-07-25-01..03).
// The session and @cds/db are mocked; the real runAction maps refusals to copy. The org
// always comes from the session and only allowlisted keys reach the chokepoint.
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const DEPS = { sections: { marker: "registry" } };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/content", () => ({ contentDeps: () => DEPS }));
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { list: () => [{ slug: "testimonials" }] },
}));

const db = vi.hoisted(() => ({
  saveNav: vi.fn(),
  saveFooter: vi.fn(),
  addAddonPageToNav: vi.fn(),
  getNav: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
  addPageToNav: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const a = await import("../app/actions/site-chrome");
const p = await import("../app/actions/pages");

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "a@b.c",
    org: { id: "org1", name: "X", primaryHost: null },
  });
});

describe("saveNavAction", () => {
  it("forwards only items (id, label, target, new_tab, children) and cta", async () => {
    db.saveNav.mockResolvedValue({ nav: { items: [] }, held: false });
    const res = await a.saveNavAction({
      items: [
        {
          id: "a",
          label: "Home",
          target: "page:x",
          new_tab: false,
          organization: "B",
          children: [
            {
              id: "b",
              label: "B",
              target: "https://x",
              new_tab: true,
              children: [1],
              evil: 1,
            },
          ],
        },
      ],
      cta: { label: "Go", target: "popup:y", extra: 1 },
      organization: "B",
      held: false,
      junk: 1,
    } as never);
    expect(res.ok).toBe(true);
    expect(db.saveNav).toHaveBeenCalledWith(CTX, DEPS, {
      items: [
        {
          id: "a",
          label: "Home",
          target: "page:x",
          new_tab: false,
          children: [
            { id: "b", label: "B", target: "https://x", new_tab: true },
          ],
        },
      ],
      cta: { label: "Go", target: "popup:y" },
    });
  });

  it("passes a null cta through", async () => {
    db.saveNav.mockResolvedValue({ nav: {}, held: false });
    await a.saveNavAction({ items: [], cta: null });
    expect(db.saveNav).toHaveBeenCalledWith(CTX, DEPS, {
      items: [],
      cta: null,
    });
  });
});

describe("saveFooterAction", () => {
  it("forwards only the five footer fields", async () => {
    db.saveFooter.mockResolvedValue({ footer: {}, held: false });
    await a.saveFooterAction({
      show_address: true,
      show_hours: false,
      show_socials: true,
      copyright: "c",
      extra_links: [
        { id: "a", label: "P", target: "page:x", new_tab: false, children: [] },
      ],
      held: true,
      organization: "B",
      report: false,
    } as never);
    expect(db.saveFooter).toHaveBeenCalledWith(CTX, DEPS, {
      show_address: true,
      show_hours: false,
      show_socials: true,
      copyright: "c",
      extra_links: [{ id: "a", label: "P", target: "page:x", new_tab: false }],
    });
  });
});

describe("addAddonPageToNavAction", () => {
  it("resolves by registry slug, never by a client page id", async () => {
    db.addAddonPageToNav.mockResolvedValue({ added: true });
    const r = await a.addAddonPageToNavAction("testimonials");
    expect(r).toEqual({ ok: true, data: { added: true } });
    expect(db.addAddonPageToNav).toHaveBeenCalledWith(
      CTX,
      DEPS,
      "testimonials",
    );
  });

  it("refuses an unknown or prototype slug before @cds/db", async () => {
    for (const slug of ["nope", "__proto__", 5 as never]) {
      const r = await a.addAddonPageToNavAction(slug);
      expect(r.ok).toBe(false);
    }
    expect(db.addAddonPageToNav).not.toHaveBeenCalled();
  });
});

describe("navStateAction", () => {
  it("returns the top count and linked page ids", async () => {
    db.getNav.mockResolvedValue({
      items: [
        {
          id: "a",
          label: "A",
          target: "page:aaaaaaaaaaaaaa1",
          new_tab: false,
          children: [],
        },
      ],
      cta: { label: "x", target: "page:aaaaaaaaaaaaaa2" },
      held: false,
    });
    expect(await a.navStateAction()).toEqual({
      ok: true,
      data: { topCount: 1, pageIds: ["aaaaaaaaaaaaaa1"] },
    });
  });
});

describe("createPageAction addToNav", () => {
  const PAGE = { id: "p1", slug: "about", title: "About" };

  it("adds the new page to the menu when addToNav is true", async () => {
    db.createPage.mockResolvedValue(PAGE);
    db.addPageToNav.mockResolvedValue({ added: true });
    const r = await p.createPageAction({
      title: "About",
      slug: "about",
      addToNav: true,
    });
    expect(db.createPage).toHaveBeenCalledWith(CTX, {
      title: "About",
      slug: "about",
    });
    expect(db.addPageToNav).toHaveBeenCalledWith(CTX, DEPS, "p1");
    expect(r).toEqual({ ok: true, data: { ...PAGE, navAdded: true } });
  });

  it("a failing menu add still returns the page", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.createPage.mockResolvedValue(PAGE);
    db.addPageToNav.mockRejectedValue(new Error("boom"));
    const r = await p.createPageAction({
      title: "About",
      slug: "about",
      addToNav: true,
    });
    expect(r).toEqual({ ok: true, data: { ...PAGE, navAdded: false } });
    expect(String(err.mock.calls[0]?.[0])).not.toContain("p1");
    err.mockRestore();
  });

  it("no menu call when addToNav is absent or not exactly true", async () => {
    db.createPage.mockResolvedValue(PAGE);
    await p.createPageAction({ title: "About", slug: "about" });
    await p.createPageAction({
      title: "About",
      slug: "about",
      addToNav: "true",
    } as never);
    expect(db.addPageToNav).not.toHaveBeenCalled();
  });
});
