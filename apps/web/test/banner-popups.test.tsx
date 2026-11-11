// 03-14: Banner and Pop-ups tabs of the Website screen (CONT-11, CONT-12, CONT-31; D117,
// D118, D123, D124, D253, D275; T-03-58..T-03-61). The real session module and runAction
// run against mocked next/headers and @cds/db, so every action assertion covers the
// cookie -> OrgContext path. Screens render with renderToStaticMarkup (node, no jsdom).
import {
  popupSummary,
  type BannerSettings,
  type PopupRecord,
} from "@cds/core/content";
import { formatShortInZone } from "@cds/ui/builder";
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
  usePathname: () => "/hub/website",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  getBanner: vi.fn(),
  saveBanner: vi.fn(),
  listPopups: vi.fn(),
  listPages: vi.fn(),
  savePopup: vi.fn(),
  setPopupEnabled: vi.fn(),
  deletePopup: vi.fn(),
  popupUsage: vi.fn(),
  readOrganizationDesign: vi.fn(),
  getContentScanner: vi.fn(() => ({ scan: vi.fn() })),
  getSearchPinger: vi.fn(() => ({ ping: vi.fn() })),
}));
vi.mock("@cds/db", () => db);

const { InvalidInput } = await import("@cds/core");
const { SECTION_REGISTRY } = await import("../lib/section-registry");
const { nextInvalidator } = await import("../lib/invalidator");
const status = await import("../app/(platform)/hub/website/banner-status");
const { WEBSITE_TABS, resolveTab } =
  await import("../app/(platform)/hub/website/tabs");
const { saveBannerAction } = await import("../app/actions/banner");
const { BannerFields } =
  await import("../app/(platform)/hub/website/BannerForm");
const { BannerTab } = await import("../app/(platform)/hub/website/BannerTab");
const popupLogic = await import("../app/(platform)/hub/website/popup-logic");
const popupActions = await import("../app/actions/popups");
const { PopupsTab } = await import("../app/(platform)/hub/website/PopupsTab");
const { resolveTheme } = await import("@cds/core/theme");
const { ALMANAC, ALMANAC_HASH } = await import("./theme-fixture");
const NEUTRAL_THEME = resolveTheme(null);

const ORG = { id: "org1", name: "Palm Science", primaryHost: "palm.example" };
const CTX = { orgId: "org1", actor: "u1", role: "owner" };
const ERR_SAVE =
  "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.";

function signIn() {
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
}

function html(el: ReactElement): string {
  return renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
}

const utc = (iso: string) => formatShortInZone(iso, "UTC");

const BANNER: BannerSettings = {
  enabled: true,
  message: "Spring sale: 20% off all classes",
  link_text: "",
  link_url: "",
  starts_at: null,
  ends_at: null,
};

beforeEach(() => {
  state.jar.clear();
  for (const fn of Object.values(db)) fn.mockReset();
  db.getContentScanner.mockReturnValue({ scan: vi.fn() });
  db.getSearchPinger.mockReturnValue({ ping: vi.fn() });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("bannerStatusLine (UI-SPEC Banner tab status table)", () => {
  const now = new Date("2026-10-05T12:00:00.000Z");
  const window = {
    starts_at: "2026-10-12T09:00:00.000Z",
    ends_at: "2026-10-19T23:59:00.000Z",
  };

  it("off", () => {
    expect(
      status.bannerStatusLine({ ...BANNER, enabled: false }, now, utc),
    ).toBe("Off. Visitors don't see a banner.");
    expect(status.bannerStatusLine(null, now, utc)).toBe(
      "Off. Visitors don't see a banner.",
    );
  });

  it("on with no schedule", () => {
    expect(status.bannerStatusLine(BANNER, now, utc)).toBe(
      "Showing on every page now.",
    );
  });

  it("scheduled in the future", () => {
    expect(status.bannerStatusLine({ ...BANNER, ...window }, now, utc)).toBe(
      "Starts 12 Oct, 9:00 am. Ends 19 Oct, 11:59 pm.",
    );
  });

  it("inside the window", () => {
    expect(
      status.bannerStatusLine(
        { ...BANNER, ...window },
        new Date("2026-10-15T00:00:00.000Z"),
        utc,
      ),
    ).toBe("Showing now until 19 Oct, 11:59 pm.");
  });

  it("ended", () => {
    expect(
      status.bannerStatusLine(
        { ...BANNER, starts_at: null, ends_at: "2026-10-03T17:00:00.000Z" },
        now,
        utc,
      ),
    ).toBe("Ended 3 Oct, 5:00 pm. Turn it off or pick new dates.");
  });

  it("uses the injected format (the owner's zone)", () => {
    const chicago = (iso: string) => formatShortInZone(iso, "America/Chicago");
    expect(
      status.bannerStatusLine({ ...BANNER, ...window }, now, chicago),
    ).toBe("Starts 12 Oct, 4:00 am. Ends 19 Oct, 6:59 pm.");
  });
});

describe("banner preview and field checks", () => {
  it("previewBanner forces the banner visible, with a placeholder when empty", () => {
    const p = status.previewBanner({
      ...BANNER,
      enabled: false,
      message: "  ",
      starts_at: "2030-01-01T00:00:00.000Z",
      ends_at: "2030-02-01T00:00:00.000Z",
    });
    expect(p).toMatchObject({
      enabled: true,
      message: status.BANNER_PREVIEW_PLACEHOLDER,
      starts_at: null,
      ends_at: null,
    });
  });

  it("bannerFieldErrors uses the server copy", () => {
    const base = {
      enabled: true,
      message: "",
      link_text: "Book now",
      link_url: "",
      starts_at: "2026-10-12T09:00:00.000Z",
      ends_at: "2026-10-11T09:00:00.000Z",
      starts_local: "x",
      ends_local: "x",
    };
    expect(status.bannerFieldErrors(base, utc)).toEqual({
      message: "Write the message visitors see in the banner.",
      link_url: "Add the address this link goes to.",
      ends_at:
        "The end time is before the start time. Pick an end after 12 Oct, 9:00 am.",
    });
    expect(
      status.bannerFieldErrors(
        {
          ...base,
          message: "Hi",
          link_text: "",
          starts_at: "",
          ends_at: "",
          starts_local: "2026-02-31T09:00",
          ends_local: "",
        },
        utc,
      ),
    ).toEqual({ starts_at: "Choose a valid date and time." });
  });

  it("bannerErrorField maps server messages to fields", () => {
    expect(status.bannerErrorField("Add the address this link goes to.")).toBe(
      "link_url",
    );
    expect(
      status.bannerErrorField(
        "The end time is before the start time. Pick an end after 12 Oct, 9:00 am.",
      ),
    ).toBe("ends_at");
    expect(status.bannerErrorField("Something else")).toBeNull();
  });
});

describe("WEBSITE_TABS (one source)", () => {
  it("is Pages, Services, Media, Forms, Navigation, Footer, Banner, Pop-ups, Site settings in that order", () => {
    expect(WEBSITE_TABS.map((t) => t.id)).toEqual([
      "pages",
      "services",
      "media",
      "forms",
      "navigation",
      "footer",
      "banner",
      "popups",
      "site",
    ]);
    expect(WEBSITE_TABS.map((t) => t.label)).toEqual([
      "Pages",
      "Services",
      "Media",
      "Forms",
      "Navigation",
      "Footer",
      "Banner",
      "Pop-ups",
      "Site settings",
    ]);
    expect(resolveTab("banner").id).toBe("banner");
    expect(resolveTab("popups").id).toBe("popups");
  });
});

describe("saveBannerAction (CONT-11, CONT-31; T-03-58)", () => {
  it("passes the session ctx, contentDeps and only known fields, never a tenant", async () => {
    signIn();
    db.saveBanner.mockResolvedValue({ banner: BANNER, held: false });
    const res = await saveBannerAction({
      ...BANNER,
      organization: "org-evil",
      extra: 1,
    } as never);
    expect(res).toEqual({ ok: true, data: { banner: BANNER, held: false } });
    const [ctx, deps, raw] = db.saveBanner.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(deps.sections).toBe(SECTION_REGISTRY);
    expect(deps.invalidator).toBe(nextInvalidator);
    expect(raw).toEqual(BANNER);
    expect(raw).not.toHaveProperty("organization");
  });

  it("a held save is a success with held true", async () => {
    signIn();
    db.saveBanner.mockResolvedValue({
      banner: { ...BANNER, enabled: false },
      held: true,
    });
    const res = await saveBannerAction(BANNER);
    expect(res).toEqual({
      ok: true,
      data: { banner: { ...BANNER, enabled: false }, held: true },
    });
  });

  it("an InvalidInput message comes back as the field copy", async () => {
    signIn();
    db.saveBanner.mockRejectedValue(
      new InvalidInput("Add the address this link goes to."),
    );
    const res = await saveBannerAction(BANNER);
    expect(res).toEqual({
      ok: false,
      code: "invalid_input",
      message: "Add the address this link goes to.",
    });
  });

  it("a signed-out caller never reaches the database", async () => {
    const res = await saveBannerAction(BANNER);
    expect(res.ok).toBe(false);
    expect(db.saveBanner).not.toHaveBeenCalled();
  });
});

describe("Banner tab screens", () => {
  it("BannerFields renders the preview in site markup, the status line and the counter", () => {
    const out = html(
      <BannerFields
        initial={{ ...BANNER, message: "Spring sale: 20% off all classes now" }}
        timeZone="UTC"
        theme={NEUTRAL_THEME}
      />,
    );
    expect(out).toContain("data-site");
    expect(out).toContain('aria-label="Announcement"');
    expect(out).toContain("Showing on every page now.");
    expect(out).toContain("36 / 140");
    expect(out).toContain('role="switch"');
    expect(out).toContain("Show banner");
    expect(out).toContain('type="datetime-local"');
    expect(out).toContain("Save banner");
    expect(out).toContain("UTC");
  });

  it("with no banner saved, the preview shows the placeholder and the Off line", () => {
    const out = html(
      <BannerFields initial={null} timeZone="UTC" theme={NEUTRAL_THEME} />,
    );
    expect(out).toContain(status.BANNER_PREVIEW_PLACEHOLDER);
    expect(out).toContain("Off. Visitors don&#x27;t see a banner.");
  });

  it("the banner preview paints with the org theme inside the inert scope (THEME-02)", () => {
    const out = html(
      <BannerFields
        initial={BANNER}
        timeZone="UTC"
        theme={resolveTheme(ALMANAC)}
      />,
    );
    expect(out).toContain(
      `<div data-site="" data-theme="${ALMANAC_HASH}" class="bg-site-surface" inert=""><style>`,
    );
    expect(out).toContain("--site-surface:#faf6ee");
    const scope = out.indexOf("data-site");
    expect(out.slice(0, scope)).toContain("Preview");
    expect(out.slice(scope)).not.toContain("Save banner</button></div></div>");
  });

  it("BannerTab reads the org theme with the session context and passes it down", async () => {
    signIn();
    db.getBanner.mockResolvedValue(BANNER);
    db.readOrganizationDesign.mockResolvedValue(ALMANAC);
    // 12-17: the form sits inside the EditorLockFrame (service-window lock).
    const frame = (await BannerTab()) as ReactElement<{
      children: ReactElement;
    }>;
    const el = frame.props.children as ReactElement<{
      initial: BannerSettings;
      theme: { hash: string; css: string };
    }>;
    expect(db.readOrganizationDesign).toHaveBeenCalledWith(CTX);
    expect(el.props.initial).toEqual(BANNER);
    expect(el.props.theme).toEqual(resolveTheme(ALMANAC));
    expect(el.props.theme.hash).toBe(ALMANAC_HASH);
  });

  it("BannerTab keeps the form and previews neutral when only the theme read fails (WR-04)", async () => {
    signIn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.getBanner.mockResolvedValue(BANNER);
    db.readOrganizationDesign.mockRejectedValue(new Error("pb timeout"));
    // 12-17: the form sits inside the EditorLockFrame (service-window lock).
    const frame = (await BannerTab()) as ReactElement<{
      children: ReactElement;
    }>;
    const el = frame.props.children as ReactElement<{
      initial: BannerSettings;
      theme: { hash: string; css: string };
    }>;
    expect(el.props.initial).toEqual(BANNER);
    expect(el.props.theme).toEqual(resolveTheme(null));
    expect(log).toHaveBeenCalledWith(
      "[hub] theme read failed",
      expect.any(Error),
    );
    expect(log).not.toHaveBeenCalledWith(
      "[hub] getBanner failed",
      expect.anything(),
    );
    log.mockRestore();
  });

  it("BannerTab shows ERR-LOAD when the banner can't be read", async () => {
    signIn();
    db.getBanner.mockRejectedValue(new Error("pb down"));
    const out = html(await BannerTab());
    expect(out).toContain("We couldn&#x27;t load this.");
    expect(out).toContain("Try again");
  });
});

// ---------------------------------------------------------------------------------------
// Pop-ups tab (Task 2)

const POPUP: PopupRecord = {
  id: "pop000000000001",
  name: "Spring offer",
  content: {
    items: [{ id: "i1", kind: "heading", text: "Spring offer", level: 2 }],
  } as PopupRecord["content"],
  trigger: "delay",
  delay_seconds: 5,
  scroll_percent: 50,
  frequency: "once-per-visitor",
  show_on: "all-pages",
  page_ids: [],
  enabled: true,
};

const CLICK_POPUP: PopupRecord = {
  ...POPUP,
  id: "pop000000000002",
  name: "Newsletter",
  trigger: "click",
  show_on: "button-only",
};

const PAGES = [
  { id: "page00000000001", title: "Home", slug: "home" },
  { id: "page00000000002", title: "About", slug: "about" },
];

describe("pop-up logic (pure)", () => {
  it("showWhereSection is false only for the click trigger", () => {
    expect(popupLogic.showWhereSection("click")).toBe(false);
    for (const t of ["delay", "scroll", "exit-intent", "page-load"] as const) {
      expect(popupLogic.showWhereSection(t)).toBe(true);
    }
  });

  it("deletePopupBody: used names the pages, unused is the P3 body (07-28, D275)", () => {
    const usage = (
      pages: { id: string; title: string }[],
      over: Partial<{
        inVersions: boolean;
        inMenu: boolean;
        used: boolean;
      }> = {},
    ) => ({ pages, inVersions: false, inMenu: false, used: true, ...over });
    expect(
      popupLogic.deletePopupBody(
        usage([
          { id: "p1", title: "Home" },
          { id: "p2", title: "About" },
        ]),
      ),
    ).toBe(
      "It leaves your pop-ups list. Buttons on Home and About keep opening it until you change them, so nothing breaks.",
    );
    expect(popupLogic.deletePopupBody(usage([], { inVersions: true }))).toBe(
      "It leaves your pop-ups list. Buttons that use it keep opening it until you change them, so nothing breaks.",
    );
    expect(popupLogic.deletePopupBody(usage([], { inMenu: true }))).toContain(
      "Buttons that use it",
    );
    expect(popupLogic.deletePopupBody(usage([], { used: false }))).toBe(
      popupLogic.DELETE_DIALOG_BODY,
    );
  });

  it("draftToInput: a click pop-up is button-only with no page ids", () => {
    const d = {
      ...popupLogic.newPopupDraft(),
      name: " Offer ",
      trigger: "click" as const,
      where: "selected-pages" as const,
      page_ids: ["page00000000001"],
    };
    expect(popupLogic.draftToInput(d, null)).toMatchObject({
      name: "Offer",
      trigger: "click",
      show_on: "button-only",
      page_ids: [],
      delay_seconds: 5,
    });
    expect(popupLogic.draftToInput(d, "pop000000000001")).toHaveProperty(
      "id",
      "pop000000000001",
    );
  });

  it("popupFieldErrors uses the server copy", () => {
    expect(
      popupLogic.popupFieldErrors({
        ...popupLogic.newPopupDraft(),
        delay: "0",
        where: "selected-pages",
      }),
    ).toEqual({
      name: "Give the pop-up a name.",
      delay: "Pick a delay from 1 to 120 seconds.",
      pages: "Choose at least one page, or show it on every page.",
    });
    expect(
      popupLogic.popupFieldErrors({
        ...popupLogic.newPopupDraft(),
        name: "Hi",
        trigger: "scroll",
        scroll: "150",
      }),
    ).toEqual({ scroll: "Pick a scroll point from 10 to 100 percent." });
  });
});

describe("pop-up actions (CONT-12, CONT-31; T-03-58, T-03-61)", () => {
  it("savePopupAction passes the session ctx, contentDeps and only known fields", async () => {
    signIn();
    db.savePopup.mockResolvedValue({ popup: POPUP, held: false });
    const { id, ...fields } = POPUP;
    const res = await popupActions.savePopupAction({
      ...fields,
      organization: "org-evil",
      id,
    });
    expect(res).toEqual({ ok: true, data: { popup: POPUP, held: false } });
    const [ctx, deps, input] = db.savePopup.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(deps.sections).toBe(SECTION_REGISTRY);
    expect(input).toEqual({ ...fields, id });
    expect(input).not.toHaveProperty("organization");
  });

  it("setPopupEnabledAction passes ctx, id and a strict boolean; held comes back", async () => {
    signIn();
    db.setPopupEnabled.mockResolvedValue({ held: true });
    const res = await popupActions.setPopupEnabledAction(POPUP.id, true);
    expect(res).toEqual({ ok: true, data: { held: true } });
    const [ctx, deps, id, enabled] = db.setPopupEnabled.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(deps.invalidator).toBe(nextInvalidator);
    expect(id).toBe(POPUP.id);
    expect(enabled).toBe(true);
    await popupActions.setPopupEnabledAction(POPUP.id, "yes" as never);
    expect(db.setPopupEnabled.mock.calls[1]![3]).toBe(false);
  });

  it("deletePopupAction returns the delete outcome", async () => {
    signIn();
    db.deletePopup.mockResolvedValue({ outcome: "soft" });
    expect(await popupActions.deletePopupAction(POPUP.id)).toEqual({
      ok: true,
      data: { outcome: "soft" },
    });
    expect(db.deletePopup.mock.calls[0]![2]).toBe(POPUP.id);
  });

  it("deletePopupAction deletes an unused pop-up; other errors become ERR-SAVE", async () => {
    signIn();
    db.deletePopup.mockResolvedValue({ outcome: "hard" });
    expect(await popupActions.deletePopupAction(POPUP.id)).toEqual({
      ok: true,
      data: { outcome: "hard" },
    });
    expect(db.deletePopup.mock.calls[0]![0]).toBe(CTX);
    db.deletePopup.mockRejectedValue(new Error("pb down"));
    expect(await popupActions.deletePopupAction(POPUP.id)).toEqual({
      ok: false,
      code: "save_failed",
      message: ERR_SAVE,
    });
  });

  it("popupUsageAction returns the referencing pages", async () => {
    signIn();
    const usage = {
      pages: [{ id: "page00000000001", title: "Home" }],
      inVersions: false,
      inMenu: false,
      used: true,
    };
    db.popupUsage.mockResolvedValue(usage);
    expect(await popupActions.popupUsageAction(POPUP.id)).toEqual({
      ok: true,
      data: usage,
    });
    expect(db.popupUsage.mock.calls[0]![0]).toBe(CTX);
  });
});

describe("Pop-ups tab screens", () => {
  it("shows EMPTY-3 when there are no pop-ups", async () => {
    signIn();
    db.listPopups.mockResolvedValue([]);
    db.listPages.mockResolvedValue(PAGES);
    const out = html(await PopupsTab({ tab: "popups" }));
    expect(out).toContain("No pop-ups yet");
    expect(out).toContain("Create pop-up");
  });

  it("lists each pop-up with its summary, a Show pop-up switch and a preview dialog", async () => {
    signIn();
    db.listPopups.mockResolvedValue([POPUP, CLICK_POPUP]);
    db.listPages.mockResolvedValue(PAGES);
    const out = html(await PopupsTab({ tab: "popups" }));
    expect(out).toContain("Spring offer");
    expect(out).toContain(popupSummary(POPUP));
    expect(out).toContain("Opens from a button");
    expect(out).toContain("Show pop-up");
    expect(out).toContain('role="switch"');
    expect(out).toContain("data-site");
    expect(out).toContain('data-cds-popup="pop000000000001"');
    expect(out).toContain("Choose a pop-up to edit it, or create a new one.");
  });

  it("the preview dialogs sit in a themed display: contents scope (THEME-02)", async () => {
    signIn();
    db.listPopups.mockResolvedValue([POPUP]);
    db.listPages.mockResolvedValue(PAGES);
    db.readOrganizationDesign.mockResolvedValue(ALMANAC);
    const out = html(await PopupsTab({ tab: "popups" }));
    expect(db.readOrganizationDesign).toHaveBeenCalledWith(CTX);
    const scope = out.indexOf(
      `<div data-site="" data-theme="${ALMANAC_HASH}" class="contents"><style>`,
    );
    expect(scope).toBeGreaterThan(0);
    expect(out.indexOf('data-cds-popup="pop000000000001"')).toBeGreaterThan(
      scope,
    );
    expect(out.slice(0, scope)).not.toContain("data-site");
  });

  it("a failed theme read still lists the pop-ups, previewed neutral (WR-04)", async () => {
    signIn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.listPopups.mockResolvedValue([POPUP]);
    db.listPages.mockResolvedValue(PAGES);
    db.readOrganizationDesign.mockRejectedValue(new Error("pb timeout"));
    const out = html(await PopupsTab({ tab: "popups" }));
    expect(out).not.toContain("We couldn&#x27;t load this.");
    expect(out).toContain('data-theme="00000000" class="contents"');
    expect(out).toContain('data-cds-popup="pop000000000001"');
    log.mockRestore();
  });

  it("the pop-up preview falls back to the neutral preset with no design", async () => {
    signIn();
    db.listPopups.mockResolvedValue([POPUP]);
    db.listPages.mockResolvedValue(PAGES);
    db.readOrganizationDesign.mockResolvedValue(null);
    const out = html(await PopupsTab({ tab: "popups" }));
    expect(out).toContain('data-theme="00000000" class="contents"');
  });

  it("the editor shows the five sections; Where is hidden for a click pop-up", async () => {
    signIn();
    db.listPopups.mockResolvedValue([POPUP, CLICK_POPUP]);
    db.listPages.mockResolvedValue(PAGES);
    const delay = html(
      await PopupsTab({ tab: "popups", popup: "pop000000000001" }),
    );
    expect(delay).toContain("Only you see this. Screen readers hear it");
    expect(delay).toContain("When it appears");
    expect(delay).toContain("How often");
    expect(delay).toContain("Only these pages");
    expect(delay).toContain(
      "Computers only. Phones and tablets don&#x27;t show it.",
    );
    expect(delay).toContain("Save pop-up");
    expect(delay).toContain("Preview pop-up");
    expect(delay).not.toContain("Open a pop-up");

    const click = html(
      await PopupsTab({ tab: "popups", popup: "pop000000000002" }),
    );
    expect(click).toContain(popupLogic.POPUP_CLICK_WHERE_COPY);
    expect(click).not.toContain("Only these pages");
  });

  it("shows ERR-LOAD when the pop-ups can't be read", async () => {
    signIn();
    db.listPopups.mockRejectedValue(new Error("pb down"));
    db.listPages.mockResolvedValue(PAGES);
    const out = html(await PopupsTab({ tab: "popups" }));
    expect(out).toContain("We couldn&#x27;t load this.");
  });
});
