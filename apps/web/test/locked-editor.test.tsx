// 12-17 Task 2 (COMM-11, D102; UI-SPEC "Locks and held changes" lines 586-608, a11y line 845):
// locked editors. The real session module and runAction run against mocked next/headers and
// @cds/db; pages render with renderToStaticMarkup (node).
//   - a page window: the builder shows the LockedPanel, the block controls sit in a disabled
//     fieldset (aria-disabled, described by the panel), Preview and History stay enabled
//   - a held change after the window: the HeldChangesPanel with Apply / Discard
//   - an organization window locks the Footer tab; an add-on window locks its add-on tab
//     (AddonTabHeader shows the LockedPanel) and not the footer
//   - the held-draft actions and the parked site-part / add-on saves
import { ToastRegion } from "@cds/ui/hub";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
  usePathname: () => "/hub/website/pages/p1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath }));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  agreementStatus: vi.fn(async () => ({ state: "current" })),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  registerAddonAlertTypes: vi.fn(),
  getContentScanner: vi.fn(() => ({ scan: vi.fn() })),
  getSearchPinger: vi.fn(() => ({ ping: vi.fn() })),
  getBillingGate: vi.fn(() => ({ approve: vi.fn() })),
  // builder route
  getPage: vi.fn(),
  listSections: vi.fn(),
  listPopups: vi.fn(),
  listForms: vi.fn(async () => []),
  readOrganizationDesign: vi.fn(async () => null),
  activeAddons: vi.fn(async () => [] as string[]),
  pausedAddons: vi.fn(async () => [] as string[]),
  getNav: vi.fn(async () => null),
  getSiteSettings: vi.fn(async () => ({ share_image: "" })),
  readOwnSiteIcons: vi.fn(async () => null),
  resolveHubMedia: vi.fn(async () => ({})),
  deletedRefsAmong: vi.fn(async () => ({ popups: [], forms: [], media: [] })),
  getBusinessProfile: vi.fn(async () => {
    throw new Error("no profile");
  }),
  readTourState: vi.fn(async () => null),
  getEntitlements: vi.fn(async () => ({ keys: [] })),
  // footer tab
  getFooter: vi.fn(async () => null),
  listPages: vi.fn(async () => []),
  // add-on tab
  addonRepo: vi.fn(),
  addonPageInfo: vi.fn(async () => null),
  // 12-17
  activeServiceNotices: vi.fn(async () => [] as unknown[]),
  listHeldDrafts: vi.fn(async () => [] as unknown[]),
  holdDraft: vi.fn(),
  applyHeldDraft: vi.fn(),
  discardHeldDraft: vi.fn(),
  undoDiscardHeldDraft: vi.fn(),
  saveFooter: vi.fn(),
  saveNav: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const { TargetLocked } = await import("@cds/core");
const builderModule =
  await import("../app/(platform)/hub/website/pages/[pageId]/page");
const { FooterTab } = await import("../app/(platform)/hub/website/FooterTab");
const { AddonPanel } = await import("../app/(platform)/hub/website/AddonPanel");
const heldActions = await import("../app/actions/held-drafts");
const chrome = await import("../app/actions/site-chrome");
const addonActions = await import("../app/actions/addons");
const { lockFromNotices, editorLockKey } =
  await import("../lib/editor-lock-shared");

const ORG = { id: "org1", name: "Palm Science", primaryHost: "palm.example" };
const CTX = { orgId: "org1", actor: "u1", role: "owner" };
const HELD_KEPT =
  "Your unsaved changes are kept. You can apply them when CDS is done.";

function signIn() {
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
}

const NOW = Date.now();
const iso = (ms: number) => new Date(NOW + ms).toISOString();

function notice(over: Record<string, unknown>) {
  return {
    id: "w1",
    code: "W-1",
    phase: "active",
    text: "CDS is working on your site",
    message: "",
    startsAt: iso(-60_000),
    endsAt: iso(3_600_000),
    incident: null,
    dismissible: false,
    reach: { scope: "everywhere" },
    scope: "organization",
    ...over,
  };
}

const ROW = {
  id: "s1",
  page: "p1",
  section_type: "hero",
  row_layout: "full",
  content: { heading: "Hi" },
  settings: { background_variant: "main" },
  sort_order: 1,
  is_published: true,
};

beforeEach(() => {
  state.jar.clear();
  vi.clearAllMocks();
  db.activeServiceNotices.mockResolvedValue([]);
  db.listHeldDrafts.mockResolvedValue([]);
  db.getPage.mockResolvedValue({
    id: "p1",
    slug: "about",
    title: "About",
    status: "draft",
    has_unpublished_changes: true,
    seo: {},
    password_protected: false,
    kind: "builder",
    published_at: "",
  });
  db.listSections.mockResolvedValue([ROW]);
  db.listPopups.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function builderHtml(): Promise<{ el: ReactElement; html: string }> {
  const el = (await builderModule.default({
    params: Promise.resolve({ pageId: "p1" }),
    searchParams: Promise.resolve({}),
  })) as ReactElement;
  return { el, html: renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>) };
}

/** The opening tag of the first element carrying `attr`. */
function tagWith(html: string, attr: string): string {
  const at = html.indexOf(attr);
  if (at < 0) return "";
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

describe("lockFromNotices (choice 2: core lockCovers over active notices)", () => {
  it("organization windows lock every target; add-on windows only their add-on", () => {
    const org = [notice({})];
    expect(
      lockFromNotices(org as never, { kind: "part", key: "footer" }),
    ).toEqual({
      until: org[0]!.endsAt,
    });
    const addon = [notice({ scope: "addon", addon: "testimonials" })];
    expect(
      lockFromNotices(addon as never, { kind: "part", key: "footer" }),
    ).toBeNull();
    expect(
      lockFromNotices(addon as never, { kind: "addon", slug: "testimonials" }),
    ).not.toBeNull();
  });

  it("page and component windows lock only their own target; upcoming never locks", () => {
    const page = [
      notice({ scope: "page", reach: { scope: "page", page: "p1" } }),
    ];
    expect(
      lockFromNotices(page as never, { kind: "page", id: "p1" }),
    ).not.toBeNull();
    expect(
      lockFromNotices(page as never, { kind: "page", id: "p2" }),
    ).toBeNull();
    const header = [
      notice({
        scope: "component",
        reach: { scope: "component", component: "header" },
      }),
    ];
    expect(
      lockFromNotices(header as never, { kind: "part", key: "header" }),
    ).not.toBeNull();
    expect(
      lockFromNotices(header as never, { kind: "part", key: "menus" }),
    ).toBeNull();
    expect(
      lockFromNotices([notice({ phase: "upcoming" })] as never, {
        kind: "page",
        id: "p1",
      }),
    ).toBeNull();
  });

  it("editorLockKey changes with the held set only, never with the lock (WR-C05)", () => {
    const a = editorLockKey({ locked: null, held: [] });
    const b = editorLockKey({ locked: { until: iso(1) }, held: [] });
    const b2 = editorLockKey({ locked: { until: iso(9_000) }, held: [] });
    const c = editorLockKey({
      locked: null,
      held: [{ id: "h1", savedAt: iso(0), locked: false }],
    });
    const d = editorLockKey({
      locked: { until: iso(1) },
      held: [{ id: "h1", savedAt: iso(0), locked: true }],
    });
    // A window starting or moving mid-edit keeps the editor mounted (unsaved edits stay).
    expect(b).toBe(a);
    expect(b2).toBe(a);
    // A parked save, Apply or Discard remounts it with fresh server state.
    expect(c).not.toBe(a);
    expect(d).toBe(c);
  });
});

describe("builder (choice 2)", () => {
  it("a page window: LockedPanel, block controls disabled not hidden, Preview and History enabled", async () => {
    signIn();
    db.activeServiceNotices.mockResolvedValue([
      notice({ scope: "page", reach: { scope: "page", page: "p1" } }),
    ]);
    const { el, html } = await builderHtml();
    expect(db.listHeldDrafts).toHaveBeenCalledWith(CTX, {
      target: { kind: "page", id: "p1" },
    });
    expect(
      (el.props as { lock: { locked: unknown } }).lock.locked,
    ).not.toBeNull();
    expect(html).toContain("data-locked-panel");
    expect(html).toContain("Editing is paused while CDS works on this page");
    // The block list and form sit in a disabled fieldset described by the panel.
    const panelTag = tagWith(html, "data-locked-panel");
    const panelId = /id="([^"]+)"/.exec(panelTag)?.[1];
    expect(panelId).toBeTruthy();
    const fieldset = tagWith(html, "data-locked-editor");
    expect(fieldset).toContain('disabled=""');
    expect(fieldset).toContain('aria-disabled="true"');
    expect(fieldset).toContain(`aria-describedby="${panelId}"`);
    // Controls stay in the page (not hidden): the block row is rendered.
    expect(html).toContain("Hero");
    // Preview is a plain link outside the fieldset; History is not disabled.
    expect(html).toContain('href="/hub/website/pages/p1/preview"');
    const history = tagWith(html, 'data-tour="builder-history"');
    expect(history).not.toMatch(/ disabled=""|aria-disabled="true"/);
    // Publish is aria-disabled and points at the panel.
    const publish = html.slice(html.indexOf('data-tour="builder-publish"'));
    expect(publish).toContain(`aria-describedby="${panelId}"`);
  });

  it("another page's window leaves the builder editable", async () => {
    signIn();
    db.activeServiceNotices.mockResolvedValue([
      notice({ scope: "page", reach: { scope: "page", page: "p2" } }),
    ]);
    const { html } = await builderHtml();
    expect(html).not.toContain("data-locked-panel");
    expect(html).not.toContain("data-locked-editor");
  });

  it("locked with a held change: HELD-KEPT and Saved at", async () => {
    signIn();
    db.activeServiceNotices.mockResolvedValue([notice({})]);
    db.listHeldDrafts.mockResolvedValue([
      {
        id: "h1",
        kind: "section",
        ref: "s1",
        target: { kind: "page", id: "p1" },
        payload: {},
        savedAt: iso(-30_000),
        locked: true,
      },
    ]);
    const { html } = await builderHtml();
    expect(html).toContain(HELD_KEPT);
    expect(html).toContain("Saved at");
  });

  it("a held change after the window: HeldChangesPanel with Apply / Discard, still read only", async () => {
    signIn();
    db.listHeldDrafts.mockResolvedValue([
      {
        id: "h1",
        kind: "section",
        ref: "s1",
        target: { kind: "page", id: "p1" },
        payload: {},
        savedAt: iso(-30_000),
        locked: false,
      },
    ]);
    const { html } = await builderHtml();
    expect(html).not.toContain("data-locked-panel");
    expect(html).toContain("data-held-panel");
    expect(html).toContain("Apply my changes");
    expect(html).toContain("Discard my changes");
    expect(tagWith(html, "data-locked-editor")).toContain("disabled");
  });

  it("a failed notices read opens the builder unlocked", async () => {
    signIn();
    db.activeServiceNotices.mockRejectedValue(new Error("down"));
    const { html } = await builderHtml();
    expect(html).not.toContain("data-locked-panel");
  });
});

describe("site parts and add-on tabs (choice 4)", () => {
  it("an organization window locks the Footer tab", async () => {
    signIn();
    db.activeServiceNotices.mockResolvedValue([notice({})]);
    const el = await FooterTab();
    const html = renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
    expect(db.listHeldDrafts).toHaveBeenCalledWith(CTX, {
      target: { kind: "part", key: "footer" },
    });
    expect(html).toContain("Editing is paused while CDS works on this footer");
    expect(tagWith(html, "data-locked-editor")).toContain("disabled");
  });

  it("an add-on window does not lock the Footer tab", async () => {
    signIn();
    db.activeServiceNotices.mockResolvedValue([
      notice({ scope: "addon", addon: "testimonials" }),
    ]);
    const html = renderToStaticMarkup(
      <ToastRegion>{await FooterTab()}</ToastRegion>,
    );
    expect(html).not.toContain("data-locked-panel");
  });

  it("an add-on window locks its add-on tab: AddonTabHeader shows the LockedPanel", async () => {
    signIn();
    db.activeAddons.mockResolvedValue(["testimonials"]);
    db.activeServiceNotices.mockResolvedValue([
      notice({ scope: "addon", addon: "testimonials" }),
    ]);
    const repo = {
      list: vi.fn(async () => [
        {
          id: "t1",
          organization: "org1",
          quote: "Great",
          author: "Ann",
          is_published: true,
          sort_order: 1,
        },
      ]),
      openHolds: vi.fn(async () => []),
    };
    db.addonRepo.mockReturnValue({ collection: () => repo });
    const el = await AddonPanel({ slug: "testimonials" });
    const html = renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
    expect(db.activeServiceNotices).toHaveBeenCalledWith(CTX, {
      activeAddons: ["testimonials"],
    });
    expect(html).toContain("data-locked-panel");
    expect(html).toContain("Editing is paused while CDS works on this add-on");
    // One panel only (the header's), and the panel's controls are disabled.
    expect(html.split("data-locked-panel").length - 1).toBe(1);
    expect(tagWith(html, "data-locked-editor")).toContain("disabled");
  });
});

describe("held-draft actions (choice 3)", () => {
  it("holdDraftAction parks a section with the session ctx and returns the fresh lock", async () => {
    signIn();
    db.holdDraft.mockResolvedValue({
      id: "h1",
      kind: "section",
      ref: "s1",
      target: { kind: "page", id: "p1" },
      payload: {},
      savedAt: iso(0),
      locked: true,
    });
    db.activeServiceNotices.mockResolvedValue([notice({})]);
    const res = await heldActions.holdDraftAction("section", "p1", {
      id: "s1",
      pageId: "p1",
      section_type: "hero",
      content: { heading: "New" },
      organization: "evil",
    });
    expect(res.ok).toBe(true);
    expect(db.holdDraft).toHaveBeenCalledWith(CTX, {
      kind: "section",
      section: {
        id: "s1",
        pageId: "p1",
        section_type: "hero",
        content: { heading: "New" },
      },
    });
    if (res.ok) expect(res.data.lock.locked).not.toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("holdDraftAction refuses an unknown kind or site part", async () => {
    signIn();
    expect((await heldActions.holdDraftAction("bogus", "x", {})).ok).toBe(
      false,
    );
    expect(
      (await heldActions.holdDraftAction("site_part", "organizations", {})).ok,
    ).toBe(false);
    // IN-C05: page-level saves are never parked (Page settings carry a password).
    expect(
      (
        await heldActions.holdDraftAction("page", "pageaaaaaaaaaa1", {
          password: "secret1",
        })
      ).ok,
    ).toBe(false);
    expect(db.holdDraft).not.toHaveBeenCalled();
  });

  it("apply passes ids only plus the editor deps; discard and undo pass ids", async () => {
    signIn();
    db.applyHeldDraft.mockResolvedValue({
      id: "h1",
      kind: "section",
      ref: "s1",
      target: { kind: "page", id: "p1" },
      held: false,
    });
    const res = await heldActions.applyHeldDraftAction("h1");
    expect(res).toEqual({ ok: true, data: { kind: "section", held: false } });
    const [ctx, id, deps] = db.applyHeldDraft.mock.calls[0]!;
    expect(ctx).toEqual(CTX);
    expect(id).toBe("h1");
    expect(typeof deps.sections.get).toBe("function");
    expect(deps.addonDeps).toBeTruthy();
    expect(revalidatePath).toHaveBeenCalledWith("/hub/website/pages/p1");

    db.discardHeldDraft.mockResolvedValue({ id: "h1", discardedAt: iso(0) });
    expect(await heldActions.discardHeldDraftAction("h1")).toEqual({
      ok: true,
      data: { id: "h1" },
    });
    db.undoDiscardHeldDraft.mockResolvedValue({
      id: "h1",
      target: { kind: "page", id: "p1" },
    });
    expect((await heldActions.undoDiscardHeldDraftAction("h1")).ok).toBe(true);
    expect((await heldActions.applyHeldDraftAction("../x")).ok).toBe(false);
    expect(db.applyHeldDraft).toHaveBeenCalledTimes(1);
  });

  it("WR-C04: Banner and Site settings share the header lock but see only their own held change", async () => {
    signIn();
    const held = (id: string, ref: string) => ({
      id,
      kind: "site_part",
      ref,
      target: { kind: "part", key: "header" },
      payload: {},
      savedAt: iso(0),
      locked: false,
    });
    db.listHeldDrafts.mockResolvedValue([
      held("hb", "banner"),
      held("hs", "settings"),
    ]);
    const { loadEditorLock } = await import("../lib/editor-lock");
    const header = { kind: "part", key: "header" } as const;
    const banner = await loadEditorLock(CTX as never, header, {
      part: "banner",
    });
    expect(banner.held.map((h) => h.id)).toEqual(["hb"]);
    const settings = await loadEditorLock(CTX as never, header, {
      part: "settings",
    });
    expect(settings.held.map((h) => h.id)).toEqual(["hs"]);
    // Nothing held for Banner: the Banner form stays editable.
    db.listHeldDrafts.mockResolvedValue([held("hs", "settings")]);
    const open = await loadEditorLock(CTX as never, header, { part: "banner" });
    expect(open.held).toEqual([]);

    // holdDraftAction's fresh lock is filtered to the held part too.
    db.listHeldDrafts.mockResolvedValue([
      held("hb", "banner"),
      held("hs", "settings"),
    ]);
    db.holdDraft.mockResolvedValue(held("hs", "settings"));
    const res = await heldActions.holdDraftAction("site_part", "settings", {
      title: "x",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.lock.held.map((h) => h.id)).toEqual(["hs"]);
  });

  it("a locked apply comes back as target_locked with LOCKED-BODY", async () => {
    signIn();
    db.applyHeldDraft.mockRejectedValue(new TargetLocked());
    const res = await heldActions.applyHeldDraftAction("h1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("target_locked");
  });
});

describe("live-save editors park a locked save (choice 4)", () => {
  it("saveFooterAction holds the cleaned footer, then returns target_locked", async () => {
    signIn();
    db.saveFooter.mockRejectedValue(new TargetLocked());
    db.holdDraft.mockResolvedValue({ id: "h1" });
    const res = await chrome.saveFooterAction({
      show_address: true,
      copyright: "© Palm",
      organization: "evil",
    } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("target_locked");
    expect(db.holdDraft).toHaveBeenCalledWith(CTX, {
      kind: "site_part",
      part: "footer",
      value: { show_address: true, copyright: "© Palm" },
    });
  });

  it("other footer failures hold nothing", async () => {
    signIn();
    db.saveFooter.mockRejectedValue(new Error("boom"));
    await chrome.saveFooterAction({ show_address: true } as never);
    expect(db.holdDraft).not.toHaveBeenCalled();
  });

  it("saveAddonRecordAction holds the record on target_locked", async () => {
    signIn();
    const save = vi.fn(async () => {
      throw new TargetLocked();
    });
    db.addonRepo.mockReturnValue({ collection: () => ({ save }) });
    db.holdDraft.mockResolvedValue({ id: "h1" });
    const res = await addonActions.saveAddonRecordAction(
      "testimonials",
      "testimonials",
      { quote: "Great", author: "Ann" },
    );
    expect(res.ok).toBe(false);
    expect(db.holdDraft).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({
        kind: "addon_record",
        slug: "testimonials",
        collection: "testimonials",
      }),
    );
  });
});
