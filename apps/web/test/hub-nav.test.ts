// 05-11 Task 1: server-composed hub nav (D311; 05-UI-SPEC "Hub shell changes"; ADDON-09,
// ADDON-11) and the add-on error copy passthrough in toActionError. 07-03: Inbox and
// Marketing sidebar items, and the /hub/inbox and /hub/marketing pages with their guards.
import {
  AddonConflict,
  AddonManifestError,
  AddonMissingRequirement,
  AddonNotActive,
  AddonRequiredBy,
  AddonWrongPath,
  NAV_ICON_KEYS,
  assertManifestShape,
  composeAddonRegistry,
} from "@cds/core/addons";
import { Forbidden, ImpersonationDenied } from "@cds/core";
import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_QUOTE,
  fixtureManifest,
  todayFixture,
} from "../../../packages/core/src/addons/__fixtures__/manifests";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
const db = vi.hoisted(() => ({
  countSubmissions: vi.fn(),
  listSubmissions: vi.fn(),
  listForms: vi.fn(),
  getSubmission: vi.fn(),
  getBusinessProfile: vi.fn(),
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  activeAddons: vi.fn(),
  getOrgStage: vi.fn(),
  agreementStatus: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const nav = vi.hoisted(() => ({
  search: new URLSearchParams(),
  pathname: "/hub/website",
  replace: vi.fn(),
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
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: nav.replace }),
  useSearchParams: () => nav.search,
}));

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

// The Contacts panel itself is 07-16's (apps/web/test/contacts-tab.test.tsx); here it is a
// stub so these cases test only the Marketing page shell and its guard.
vi.mock("../app/(platform)/hub/marketing/ContactsTab", async () => {
  const { createElement } = await import("react");
  return {
    ContactsTab: async () => createElement("h2", null, "Contacts"),
  };
});

// The Social panel is 11-37's (apps/web/test/marketing-social.test.tsx).
vi.mock("../app/(platform)/hub/marketing/SocialTab", async () => {
  const { createElement } = await import("react");
  return {
    SocialTab: async () => createElement("h2", null, "My social accounts"),
  };
});

// The Inbox panel itself is 07-19's (apps/web/test/inbox-page.test.tsx); here it is a stub so
// these cases test only the Inbox page shell, its tab bar and its guard.
vi.mock("../app/(platform)/hub/inbox/InboxPanel", async () => {
  const { createElement } = await import("react");
  return {
    InboxPanel: (p: { params: { tab: string } }) =>
      createElement("section", { "data-inbox-panel": p.params.tab }),
  };
});

const {
  composeHubNav,
  GET_ADDONS,
  INBOX_NAV,
  MARKETING_NAV,
  SETUP_NAV,
  SETTINGS_NAV,
  SETUP_STAGES,
  inSetup,
  TODAY_NAV,
  REPORTS_NAV,
  HELP_NAV,
  SUPPORT_NAV,
} = await import("../app/(platform)/hub/nav");
const { inboxUnreadCount } = await import("../app/(platform)/hub/inbox/unread");
const { HubNotice, EXISTING_OWNER_COPY, withoutNotice } =
  await import("../app/(platform)/hub/HubNotice");
const { HubShell, contentMode } =
  await import("../app/(platform)/hub/HubShell");
const { ToastRegion } = await import("@cds/ui/hub");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { toActionError } = await import("../lib/action");
const { getTrainingFor } = await import("../lib/training");
const { CORE_TRAINING } = await import("@cds/core/training");
const { default: MarketingPage } =
  await import("../app/(platform)/hub/marketing/page");
const { MARKETING_TABS, resolveMarketingTab, marketingTabHref } =
  await import("../app/(platform)/hub/marketing/tabs");
const { default: InboxPage } = await import("../app/(platform)/hub/inbox/page");
const { SHELL_PANEL_BODY } = await import("../app/(platform)/hub/website/tabs");
const {
  HUB_SECTIONS,
  composeSectionTabs,
  composeMarketingTabs,
  sectionForHref,
} = await import("../app/(platform)/hub/sections");
const { SETTINGS_TABS } = await import("../app/(platform)/hub/settings/tabs");
const { REPORTS_TABS, resolveReportsTab, reportsTabHref } =
  await import("../app/(platform)/hub/reports/tabs");

const SIDEBAR = fixtureManifest({
  slug: "fixture-side",
  order: 960,
  nav: { placement: "sidebar", label: "Side", icon: "BadgeCheck" },
});

const registry = composeAddonRegistry([FIXTURE_QUOTE, SIDEBAR], {
  fileExists: () => true,
});

const WEBSITE = { href: "/hub/website", label: "Website", iconKey: "Globe" };
const SETTINGS = {
  href: "/hub/settings",
  label: "Settings",
  iconKey: "Settings",
};
const INBOX = { href: "/hub/inbox", label: "Inbox", iconKey: "Inbox" };
const MARKETING = {
  href: "/hub/marketing",
  label: "Marketing",
  iconKey: "Megaphone",
};

const TODAY = { href: "/hub/today", label: "Today", iconKey: "House" };
const ALERTS = { href: "/hub/alerts", label: "Alerts", iconKey: "Bell" };
const GALLERY = { href: "/hub/gallery", label: "Gallery", iconKey: "Images" };
const REPORTS = {
  href: "/hub/reports",
  label: "Reports",
  iconKey: "ChartColumn",
};
const PHONE = {
  href: "/hub/help/phone-app",
  label: "Phone app setup",
  iconKey: "Smartphone",
};
const HELP = { href: "/hub/help", label: "Help", iconKey: "CircleHelp" };
const SUPPORT = {
  href: "/hub/support",
  label: "Support",
  iconKey: "LifeBuoy",
};

function item(
  key: string,
  section: string,
  extra: Record<string, unknown> = {},
) {
  return {
    key,
    kind: key.split(":")[0] ?? key,
    level: "normal" as const,
    title: key,
    actionLabel: "Open",
    href: "/hub/today",
    section,
    at: "2026-10-01T00:00:00.000Z",
    ...extra,
  } as never;
}

describe("composeHubNav (11-14 D311 order: Today, Inbox, Website, add-ons, Marketing, Reports, Settings)", () => {
  it("owner on a live org: the full list in D311 order; Get add-ons, Help and Support pinned", () => {
    const nav = composeHubNav({
      role: "owner",
      grants: [],
      active: [],
      registry,
      stage: "live",
    });
    expect(nav.items).toEqual([
      TODAY,
      ALERTS,
      GALLERY,
      INBOX,
      WEBSITE,
      MARKETING,
      REPORTS,
      SETTINGS,
    ]);
    expect(nav.pinned).toEqual([GET_ADDONS, PHONE, HELP, SUPPORT]);
    expect(GET_ADDONS).toEqual({
      href: "/hub/add-ons",
      label: "Get add-ons",
      iconKey: "PackagePlus",
    });
  });

  it("exports frozen Today, Reports, Help and Support items", () => {
    expect(TODAY_NAV).toEqual(TODAY);
    expect(REPORTS_NAV).toEqual(REPORTS);
    expect(HELP_NAV).toEqual(HELP);
    expect(SUPPORT_NAV).toEqual(SUPPORT);
    for (const i of [TODAY_NAV, REPORTS_NAV, HELP_NAV, SUPPORT_NAV]) {
      expect(Object.isFrozen(i)).toBe(true);
    }
  });

  it("admin sees Get add-ons too", () => {
    const nav = composeHubNav({
      role: "admin",
      grants: [],
      active: [],
      registry,
    });
    expect(nav.items).toEqual([
      TODAY,
      ALERTS,
      GALLERY,
      INBOX,
      WEBSITE,
      MARKETING,
      REPORTS,
      SETTINGS,
    ]);
    expect(nav.pinned).toEqual([GET_ADDONS, PHONE, HELP, SUPPORT]);
  });

  it("editor and viewer: no Get add-ons; only the editor sees Settings; both see Marketing (Social, 11-37) and Reports (D310)", () => {
    const editor = composeHubNav({
      role: "editor",
      grants: [],
      active: [],
      registry,
    });
    expect(editor.items).toEqual([
      TODAY,
      ALERTS,
      INBOX,
      WEBSITE,
      MARKETING,
      REPORTS,
      SETTINGS,
    ]);
    expect(editor.pinned).toEqual([PHONE, HELP, SUPPORT]);
    const viewer = composeHubNav({
      role: "viewer",
      grants: [],
      active: [],
      registry,
    });
    expect(viewer.items).toEqual([
      TODAY,
      ALERTS,
      INBOX,
      WEBSITE,
      MARKETING,
      REPORTS,
    ]);
    expect(viewer.items.map((i) => i.href)).not.toContain("/hub/settings");
    expect(viewer.pinned).toEqual([PHONE, HELP, SUPPORT]);
  });

  it("a grant-only staff member: Today, Website for an active granted add-on; no Marketing (A&M: seats see their setup only), no Reports", () => {
    const nav = composeHubNav({
      role: "staff",
      grants: ["fixture-quote"],
      active: ["fixture-quote"],
      registry,
    });
    expect(nav.items).toEqual([TODAY, ALERTS, WEBSITE]);
    expect(nav.pinned).toEqual([PHONE, HELP]);
    const off = composeHubNav({
      role: "staff",
      grants: ["fixture-quote"],
      active: [],
      registry,
    });
    expect(off.items).toEqual([TODAY, ALERTS]);
  });

  it("an active sidebar add-on sits between Website and Marketing; an inactive one is absent", () => {
    const on = composeHubNav({
      role: "owner",
      grants: [],
      active: ["fixture-side"],
      registry,
    });
    expect(on.items).toEqual([
      TODAY,
      ALERTS,
      GALLERY,
      INBOX,
      WEBSITE,
      { href: "/hub/fixture-side", label: "Side", iconKey: "BadgeCheck" },
      MARKETING,
      REPORTS,
      SETTINGS,
    ]);
    const off = composeHubNav({
      role: "owner",
      grants: [],
      active: [],
      registry,
    });
    expect(off.items.map((i) => i.href)).not.toContain("/hub/fixture-side");
  });

  it("sidebar add-ons follow manifest order", () => {
    const two = composeAddonRegistry(
      [
        fixtureManifest({
          slug: "side-late",
          order: 990,
          nav: { placement: "sidebar", label: "Late", icon: "BadgeCheck" },
        }),
        fixtureManifest({
          slug: "side-early",
          order: 980,
          nav: { placement: "sidebar", label: "Early", icon: "BadgeCheck" },
        }),
      ],
      { fileExists: () => true },
    );
    const n = composeHubNav({
      role: "owner",
      grants: [],
      active: ["side-late", "side-early"],
      registry: two,
    });
    expect(n.items.map((i) => i.href)).toEqual([
      "/hub/today",
      "/hub/alerts",
      "/hub/gallery",
      "/hub/inbox",
      "/hub/website",
      "/hub/side-early",
      "/hub/side-late",
      "/hub/marketing",
      "/hub/reports",
      "/hub/settings",
    ]);
  });

  it("tab-placement add-ons never become sidebar items", () => {
    const nav = composeHubNav({
      role: "owner",
      grants: [],
      active: ["fixture-quote"],
      registry,
    });
    expect(nav.items.map((i) => i.href)).toEqual([
      "/hub/today",
      "/hub/alerts",
      "/hub/gallery",
      "/hub/inbox",
      "/hub/website",
      "/hub/marketing",
      "/hub/reports",
      "/hub/settings",
    ]);
  });

  it("a sidebar add-on shows to a grant holder only with the grant", () => {
    const without = composeHubNav({
      role: "editor",
      grants: [],
      active: ["fixture-side"],
      registry,
    });
    expect(without.items.map((i) => i.href)).not.toContain("/hub/fixture-side");
    const withGrant = composeHubNav({
      role: "staff",
      grants: ["fixture-side"],
      active: ["fixture-side"],
      registry,
    });
    // A&M fork: a sidebar add-on adds no empty Website item, and a seat gets no Marketing.
    expect(withGrant.items.map((i) => i.href)).toEqual([
      "/hub/today",
      "/hub/alerts",
      "/hub/fixture-side",
    ]);
  });
});

describe("composeHubNav: setup stages (06-18, D312; 11-14 Pitfall 2)", () => {
  const base = { grants: [], active: [], registry } as const;

  it("Set up your site is first, before Today, with the needed count while in intake", () => {
    const n = composeHubNav({
      ...base,
      role: "owner",
      stage: "intake",
      stillNeededCount: 2,
    });
    expect(n.items[0]).toEqual({ ...SETUP_NAV, badge: 2 });
    expect(n.items[0]).toMatchObject({
      href: "/hub/setup",
      label: "Set up your site",
      iconKey: "ListChecks",
    });
    expect(n.items[1]).toEqual(TODAY);
    expect(n.items.at(-1)).toEqual(SETTINGS_NAV);
  });

  it("fit_review and ready_for_build keep the item; no badge when nothing is needed", () => {
    for (const stage of ["fit_review", "ready_for_build"] as const) {
      const n = composeHubNav({
        ...base,
        role: "owner",
        stage,
        stillNeededCount: 0,
      });
      expect(n.items[0]).toEqual({ ...SETUP_NAV });
      expect(n.items[0]).not.toHaveProperty("badge");
    }
    expect(SETUP_STAGES).toEqual(["intake", "fit_review", "ready_for_build"]);
  });

  it("being_built and later: no setup item (Today takes over, D312)", () => {
    for (const stage of [
      "being_built",
      "ready_for_review",
      "live",
      "",
      undefined,
    ] as const) {
      const n = composeHubNav({
        ...base,
        role: "owner",
        stage,
        stillNeededCount: 3,
      });
      expect(n.items.map((i) => i.href)).not.toContain("/hub/setup");
    }
    expect(inSetup("being_built")).toBe(false);
    expect(inSetup("intake")).toBe(true);
  });

  it("a viewer (no business read) gets neither setup nor Settings", () => {
    const n = composeHubNav({
      ...base,
      role: "viewer",
      stage: "intake",
      stillNeededCount: 1,
    });
    expect(n.items.map((i) => i.href)).toEqual([
      "/hub/today",
      "/hub/alerts",
      "/hub/inbox",
      "/hub/website",
      "/hub/marketing",
      "/hub/reports",
    ]);
  });

  it("an editor sees setup (read-only steps) and Settings", () => {
    const n = composeHubNav({ ...base, role: "editor", stage: "intake" });
    expect(n.items.map((i) => i.href)).toEqual([
      "/hub/setup",
      "/hub/today",
      "/hub/alerts",
      "/hub/inbox",
      "/hub/website",
      "/hub/marketing",
      "/hub/reports",
      "/hub/settings",
    ]);
  });

  it("a sidebar add-on can never shadow a core hub segment", () => {
    const slugs = [
      "setup",
      "settings",
      "today",
      "reports",
      "help",
      "profile",
      "support",
    ];
    const shadow = composeAddonRegistry(
      slugs.map((slug, i) =>
        fixtureManifest({
          slug,
          order: 970 + i,
          nav: {
            placement: "sidebar",
            label: `Shadow ${slug}`,
            icon: "BadgeCheck",
          },
        }),
      ),
      { fileExists: () => true },
    );
    const n = composeHubNav({
      role: "owner",
      grants: [],
      active: slugs,
      registry: shadow,
    });
    for (const slug of slugs) {
      expect(n.items.map((i) => i.label)).not.toContain(`Shadow ${slug}`);
    }
  });
});

describe("composeHubNav: badges from Needs you (DASH-27)", () => {
  const base = { grants: [], active: [], registry, role: "owner" } as const;

  it("Inbox badge 2 for two inbox items; Settings counts its items; Today never has a badge", () => {
    const n = composeHubNav({
      ...base,
      needsYou: {
        items: [
          item("inbox:a", "inbox"),
          item("inbox:b", "inbox"),
          item("billing:fix_card", "settings", { tab: "billing" }),
          item("intake:logo", "today"),
        ],
        failed: [],
      },
    });
    const by = Object.fromEntries(n.items.map((i) => [i.href, i.badge]));
    expect(by["/hub/inbox"]).toBe(2);
    expect(by["/hub/settings"]).toBe(1);
    expect(n.items.find((i) => i.href === "/hub/today")).not.toHaveProperty(
      "badge",
    );
    expect(n.items.find((i) => i.href === "/hub/website")).not.toHaveProperty(
      "badge",
    );
  });

  it("a billing provider failure omits the Settings badge", () => {
    const n = composeHubNav({
      ...base,
      needsYou: {
        items: [
          item("inbox:a", "inbox"),
          item("email:r1", "settings", { tab: "email" }),
        ],
        failed: ["billing"],
      },
    });
    const settings = n.items.find((i) => i.href === "/hub/settings");
    expect(settings).toEqual(SETTINGS);
    expect(settings).not.toHaveProperty("badge");
    expect(n.items.find((i) => i.href === "/hub/inbox")?.badge).toBe(1);
  });

  it("an inbox failure omits the Inbox badge; the true unread count wins when given", () => {
    const failed = composeHubNav({
      ...base,
      needsYou: { items: [item("inbox:a", "inbox")], failed: ["inbox"] },
      inboxUnread: 30,
    });
    expect(failed.items.find((i) => i.href === "/hub/inbox")).toEqual(INBOX);
    const capped = composeHubNav({
      ...base,
      needsYou: { items: [item("inbox:a", "inbox")], failed: [] },
      inboxUnread: 30,
    });
    // The Needs-you inbox list stops at 20; the layout's countSubmissions is the true count.
    expect(capped.items.find((i) => i.href === "/hub/inbox")?.badge).toBe(30);
  });

  it("the Inbox badge shows only for a count above zero", () => {
    const four = composeHubNav({ ...base, inboxUnread: 4 });
    expect(four.items[3]).toEqual({ ...INBOX, badge: 4 });
    for (const inboxUnread of [0, -2, Number.NaN, undefined]) {
      const n = composeHubNav({ ...base, inboxUnread });
      expect(n.items[3]).toEqual(INBOX);
      expect(n.items[3]).not.toHaveProperty("badge");
    }
  });

  it("a sidebar add-on carries its own section count; an add-ons outage omits it", () => {
    const items = [item("fixture-side:x", "addon:fixture-side")];
    const on = composeHubNav({
      ...base,
      active: ["fixture-side"],
      needsYou: { items, failed: [] },
    });
    expect(on.items.find((i) => i.href === "/hub/fixture-side")?.badge).toBe(1);
    for (const failed of [["addons"], ["addon:fixture-side"]]) {
      const off = composeHubNav({
        ...base,
        active: ["fixture-side"],
        needsYou: { items, failed },
      });
      expect(
        off.items.find((i) => i.href === "/hub/fixture-side"),
      ).not.toHaveProperty("badge");
    }
  });

  it("a Website-tab add-on's items count on Website", () => {
    const n = composeHubNav({
      ...base,
      active: ["fixture-quote"],
      needsYou: {
        items: [item("fixture-quote:q", "addon:fixture-quote")],
        failed: [],
      },
    });
    expect(n.items.find((i) => i.href === "/hub/website")?.badge).toBe(1);
  });

  it("items for a section the person cannot see never surface as a badge", () => {
    const n = composeHubNav({
      ...base,
      role: "viewer",
      needsYou: {
        items: [item("billing:fix_card", "settings")],
        failed: [],
      },
    });
    expect(n.items.some((i) => i.badge !== undefined)).toBe(false);
  });
});

describe("composeHubNav: Inbox and Marketing (07-03, D311, D-UI-P7-1)", () => {
  it("exports the frozen Inbox and Marketing items", () => {
    expect(INBOX_NAV).toEqual(INBOX);
    expect(MARKETING_NAV).toEqual(MARKETING);
    expect(Object.isFrozen(INBOX_NAV)).toBe(true);
    expect(Object.isFrozen(MARKETING_NAV)).toBe(true);
  });

  it("no add-on may take a hub segment or core Website tab id", () => {
    for (const slug of [
      "inbox",
      "marketing",
      "media",
      "forms",
      "navigation",
      "footer",
      "site",
    ]) {
      expect(() => assertManifestShape(fixtureManifest({ slug }))).toThrow(
        AddonManifestError,
      );
      expect(() => assertManifestShape(fixtureManifest({ slug }))).toThrow(
        /is reserved/,
      );
    }
  });

  it("NAV_ICON_KEYS has the Inbox and Megaphone icons", () => {
    expect(NAV_ICON_KEYS).toContain("Inbox");
    expect(NAV_ICON_KEYS).toContain("Megaphone");
  });

  it("inboxUnreadCount is countSubmissions(ctx).unread (07-19)", async () => {
    db.countSubmissions.mockResolvedValueOnce({ unread: 4, filtered: 2 });
    const ctx = { orgId: "org1", role: "owner", grants: [] };
    await expect(inboxUnreadCount(ctx as never)).resolves.toBe(4);
    expect(db.countSubmissions).toHaveBeenCalledWith(ctx);
  });
});

// The /hub index redirect tests moved to hub-index.test.ts (11-14).

describe("HubNotice (D286 existing owner)", () => {
  it("shows the EXISTING-OWNER info alert when the notice is set", () => {
    nav.search = new URLSearchParams("notice=existing-owner&tab=pages");
    const html = renderToStaticMarkup(createElement(HubNotice));
    expect(html).toContain(EXISTING_OWNER_COPY);
    expect(EXISTING_OWNER_COPY).toBe(
      "You already have a site with us, so we signed you in to it. We kept your new quote, and Support will be in touch about it.",
    );
  });

  it("09-19: terms-updated shows MEMBER-OUTDATED", () => {
    nav.search = new URLSearchParams("notice=terms-updated");
    const html = renderToStaticMarkup(createElement(HubNotice));
    expect(html).toContain(
      "Support updated its terms. Your site owner needs to accept them; nothing changes for you or your site meanwhile.",
    );
  });

  it("renders nothing without the notice or with an unknown one", () => {
    nav.search = new URLSearchParams("");
    expect(renderToStaticMarkup(createElement(HubNotice))).toBe("");
    nav.search = new URLSearchParams("notice=<script>");
    expect(renderToStaticMarkup(createElement(HubNotice))).toBe("");
  });

  it("strips only the notice param from the URL", () => {
    expect(
      withoutNotice("/hub/setup", new URLSearchParams("notice=existing-owner")),
    ).toBe("/hub/setup");
    expect(
      withoutNotice(
        "/hub/website",
        new URLSearchParams("notice=existing-owner&tab=pages"),
      ),
    ).toBe("/hub/website?tab=pages");
  });
});

describe("toActionError: add-on copy passthrough", () => {
  it.each([
    [new AddonMissingRequirement("A needs B. Add B first.", ["b"])],
    [new AddonConflict("A can't run alongside B. Remove B first.", "b")],
    [new AddonRequiredBy("B needs A. Remove B first.", ["b"])],
    [new AddonWrongPath("A isn't offered for this kind of site.")],
    [new AddonNotActive("Testimonials is off.")],
  ])("%s keeps its message", (err) => {
    const res = toActionError(err);
    expect(res.code).toBe(err.code);
    expect(res.message).toBe(err.message);
  });

  it("forbidden and impersonation keep the generic copy without an override", () => {
    expect(toActionError(new Forbidden("x")).message).toMatch(
      /Ask the site owner/,
    );
    expect(toActionError(new ImpersonationDenied("x")).code).toBe("forbidden");
  });

  it("a copy override replaces the forbidden and impersonation messages", () => {
    const copy = {
      forbidden: "Only the site owner can add or remove add-ons.",
      impersonation:
        "Add-ons can't be added while you're viewing as the owner. Use the staff console to add one.",
    };
    expect(toActionError(new Forbidden("x"), copy)).toMatchObject({
      code: "forbidden",
      message: copy.forbidden,
    });
    expect(toActionError(new ImpersonationDenied("x"), copy)).toMatchObject({
      code: "impersonation_denied",
      message: copy.impersonation,
    });
  });
});

describe("getTrainingFor (ADDON-11)", () => {
  const ctx = { orgId: "org1" } as never;

  it("returns core training only when no add-on is on", async () => {
    db.activeAddons.mockResolvedValueOnce([]);
    const list = await getTrainingFor(ctx);
    expect(list).toEqual([...CORE_TRAINING]);
    expect(db.activeAddons).toHaveBeenCalledWith(ctx);
  });

  it("adds only the active add-ons' training, after core", async () => {
    db.activeAddons.mockResolvedValueOnce(["testimonials"]);
    const ids = (await getTrainingFor(ctx)).map((t) => t.id);
    expect(ids.slice(0, CORE_TRAINING.length)).toEqual(
      CORE_TRAINING.map((t) => t.id),
    );
    expect(ids).toContain("addon-testimonials");
    expect(ids).not.toContain("addon-credentials");
  });
});

describe("Marketing tabs (07-03)", () => {
  it("Contacts then Social (11-37); unknown, missing or array values land on the first allowed tab", () => {
    expect(MARKETING_TABS).toEqual([
      { id: "contacts", label: "Contacts" },
      { id: "social", label: "Social" },
    ]);
    for (const raw of ["contacts", undefined, "bogus", ["x"], ["contacts"]]) {
      expect(resolveMarketingTab(raw)).toBe("contacts");
    }
    expect(resolveMarketingTab("social")).toBe("social");
    expect(resolveMarketingTab(["social"])).toBe("social");
    // Editors and Viewers may open Social only.
    expect(resolveMarketingTab("contacts", ["social"])).toBe("social");
    expect(resolveMarketingTab(undefined, ["social"])).toBe("social");
    expect(marketingTabHref("contacts")).toBe("/hub/marketing?tab=contacts");
  });
});

function asRole(role: string) {
  sess.requireHubSession.mockResolvedValue({
    ctx: { orgId: "org1", role, grants: role === "staff" ? ["x"] : [] },
  });
}

async function renderPage(
  page: (p: {
    searchParams: Promise<Record<string, string>>;
  }) => Promise<unknown>,
  q: Record<string, string> = {},
): Promise<string> {
  const el = await page({ searchParams: Promise.resolve(q) });
  return renderToStaticMarkup(el as ReturnType<typeof createElement>);
}

function currentTab(html: string): string | null {
  const current = [...html.matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('aria-current="page"'))
    .map((tag) => /href="\?tab=([^"]+)"/.exec(tag)?.[1])
    .filter((id): id is string => id !== undefined);
  return current.length === 1 ? current[0]! : null;
}

describe("Marketing page (07-03)", () => {
  it("owner: H1 Marketing, a Marketing sections tab bar with Contacts current, the Contacts panel", async () => {
    asRole("owner");
    const html = await renderPage(MarketingPage, { tab: "contacts" });
    expect(html).toMatch(/<h1[^>]*>Marketing<\/h1>/);
    expect(html).toContain('aria-label="Marketing sections"');
    expect(currentTab(html)).toBe("contacts");
    expect(html).toMatch(/<h2[^>]*>Contacts<\/h2>/);
    // 07-16 filled the 07-03 shell.
    expect(html).not.toContain(SHELL_PANEL_BODY.replace("'", "&#x27;"));
  });

  it("admin gets the page (an unknown tab lands on Contacts); staff and renter seats get 404 (A&M)", async () => {
    asRole("admin");
    const html = await renderPage(MarketingPage, { tab: "bogus" });
    expect(currentTab(html)).toBe("contacts");
    for (const role of ["staff", "renter"]) {
      asRole(role);
      await expect(renderPage(MarketingPage, { tab: "bogus" })).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
    }
  });

  it("editor and viewer (no contacts read) get Social only, never Contacts (11-37)", async () => {
    for (const role of ["editor", "viewer"]) {
      asRole(role);
      const html = await renderPage(MarketingPage, { tab: "contacts" });
      expect(currentTab(html)).toBe("social");
      expect(html).not.toContain('href="?tab=contacts"');
    }
  });
});

function inboxTabs(html: string): { id: string; current: boolean }[] {
  return [...html.matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('href="/hub/inbox?tab='))
    .map((tag) => ({
      id: /href="\/hub\/inbox\?tab=([a-z]+)/.exec(tag)![1]!,
      current: tag.includes('aria-current="page"'),
    }));
}

describe("Inbox page (07-03; 07-19 filled the shell)", () => {
  function inboxData(filtered = 0) {
    db.countSubmissions.mockResolvedValue({ unread: 0, filtered });
    db.listSubmissions.mockResolvedValue({
      items: [],
      page: 1,
      perPage: 50,
      totalItems: 0,
      totalPages: 0,
    });
    db.listForms.mockResolvedValue([]);
    db.getBusinessProfile.mockResolvedValue({ time_zone: "UTC" });
  }

  it("owner, editor and viewer: H1 Inbox, Messages · Filtered with Messages current, the panel", async () => {
    inboxData();
    for (const role of ["owner", "editor", "viewer"]) {
      asRole(role);
      const html = await renderPage(InboxPage);
      expect(html).toMatch(/<h1[^>]*>Inbox<\/h1>/);
      expect(html).toContain('aria-label="Inbox sections"');
      expect(inboxTabs(html)).toEqual([
        { id: "messages", current: true },
        { id: "filtered", current: false },
      ]);
      expect(html).toContain('data-inbox-panel="messages"');
      expect(html).not.toContain(SHELL_PANEL_BODY.replace("'", "&#x27;"));
    }
  });

  it("?tab=filtered marks Filtered current and shows its count; an unknown tab lands on Messages", async () => {
    inboxData(3);
    asRole("owner");
    const filtered = await renderPage(InboxPage, { tab: "filtered" });
    expect(inboxTabs(filtered)).toEqual([
      { id: "messages", current: false },
      { id: "filtered", current: true },
    ]);
    expect(filtered).toContain("Filtered · 3");
    expect(filtered).toContain('data-inbox-panel="filtered"');
    expect(inboxTabs(await renderPage(InboxPage, { tab: "bogus" }))[0]).toEqual(
      { id: "messages", current: true },
    );
  });

  it("a grant-only staff member (no content read) gets a 404", async () => {
    asRole("staff");
    await expect(renderPage(InboxPage)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("contentMode: focused re-accept frame (09-17, D-UI-P9-3)", () => {
  it("is focused only for /hub/agreement with mode=reaccept", () => {
    const q = (v: string) => new URLSearchParams(v);
    expect(contentMode("/hub/agreement", q("mode=reaccept&next=%2Fhub"))).toBe(
      "focused",
    );
    expect(contentMode("/hub/agreement/", q("mode=reaccept"))).toBe("focused");
    expect(contentMode("/hub/agreement", q(""))).toBe("standard");
    expect(contentMode("/hub/agreement", q("mode=sign"))).toBe("standard");
    expect(contentMode("/hub/agreement")).toBe("standard");
    expect(contentMode("/hub/agreement", null)).toBe("standard");
    expect(contentMode("/hub/agreement/signed/abc", q("mode=reaccept"))).toBe(
      "standard",
    );
    expect(contentMode("/hub/setup", q("mode=reaccept"))).toBe("standard");
  });

  it("keeps the builder and preview modes", () => {
    expect(contentMode("/hub/website")).toBe("standard");
    expect(contentMode("/hub/website/pages/p1")).toBe("builder");
    expect(contentMode("/hub/website/pages/p1/preview")).toBe("bare");
    expect(contentMode("/hub/website/pages/p1/other")).toBe("standard");
  });

  function shell(): string {
    // The hub layout provides the ToastRegion in the app (ERR-SWITCH toast, 11-16).
    return renderToStaticMarkup(
      createElement(
        ToastRegion,
        null,
        createElement(HubShell, {
          businessName: "Rivera Bakery",
          siteUrl: null,
          email: "ana@example.com",
          nav: [
            { href: "/hub/website", label: "Website", iconKey: "Globe" },
            { href: "/hub/settings", label: "Settings", iconKey: "Settings" },
          ],
          pinned: [],
          children: createElement("h1", null, "We've updated our terms"),
        }),
      ),
    );
  }

  it("focused frame: header with name and Sign out, no sidebar, no menu button", () => {
    nav.pathname = "/hub/agreement";
    nav.search = new URLSearchParams("mode=reaccept&next=%2Fhub%2Fsetup");
    try {
      const html = shell();
      expect(html).toContain("Rivera Bakery");
      expect(html).toContain("Sign out");
      expect(html).toContain("We&#x27;ve updated our terms");
      expect(html).not.toContain('aria-label="Hub"');
      expect(html).not.toContain("Open menu");
      expect(html).not.toContain("/hub/settings");
    } finally {
      nav.pathname = "/hub/website";
      nav.search = new URLSearchParams();
    }
  });

  it("sign mode keeps the sidebar", () => {
    nav.pathname = "/hub/agreement";
    nav.search = new URLSearchParams("");
    try {
      const html = shell();
      expect(html).toContain('aria-label="Hub"');
      expect(html).toContain("Open menu");
    } finally {
      nav.pathname = "/hub/website";
    }
  });
});

describe("HUB_SECTIONS: one tab source (11-14 DASH-25, DASH-26)", () => {
  const reg = composeAddonRegistry([FIXTURE_QUOTE, todayFixture], {
    fileExists: () => true,
  });
  const owner = { role: "owner", grants: [], registry: reg } as const;

  it("Settings tab ids equal SETTINGS_TABS ids for an Owner (one source)", () => {
    expect(
      HUB_SECTIONS.settings.tabs({ ...owner, active: [] }).map((t) => t.id),
    ).toEqual(
      SETTINGS_TABS.map((t) => t.id).filter(
        (id) => id !== "payments" && id !== "billing",
      ),
    );
  });

  it("Settings tabs follow the page's role filter; a Viewer gets none", () => {
    const admin = HUB_SECTIONS.settings
      .tabs({ ...owner, role: "admin", active: [] })
      .map((t) => t.id);
    expect(admin).not.toContain("billing");
    expect(admin).toContain("business");
    expect(
      HUB_SECTIONS.settings.tabs({ ...owner, role: "viewer", active: [] }),
    ).toEqual([]);
  });

  it("every tab has a ?tab= href and a <section>.<tab> helpId", () => {
    const tabs = HUB_SECTIONS.settings.tabs({ ...owner, active: [] });
    expect(tabs[0]).toEqual({
      id: "business",
      label: "Business info",
      href: "/hub/settings?tab=business",
      helpId: "settings.business",
    });
    expect(HUB_SECTIONS.website.helpId).toBe("website");
  });

  it("Marketing includes the fixture add-on tab (nav.item marketing) only while it is active", () => {
    const on = HUB_SECTIONS.marketing.tabs({
      ...owner,
      active: ["today-fixture"],
    });
    expect(on.map((t) => t.id)).toEqual([
      "contacts",
      "social",
      "today-fixture",
    ]);
    expect(on[2]).toMatchObject({
      label: "Today fixture",
      href: "/hub/marketing?tab=today-fixture",
      helpId: "marketing.today-fixture",
    });
    const off = HUB_SECTIONS.marketing.tabs({ ...owner, active: [] });
    expect(off.map((t) => t.id)).toEqual(["contacts", "social"]);
    // A marketing add-on never lands under Website.
    expect(
      HUB_SECTIONS.website
        .tabs({ ...owner, active: ["today-fixture"] })
        .map((t) => t.id),
    ).not.toContain("today-fixture");
  });

  it("Website delegates to composeWebsiteTabs (core tabs + the active Website add-on)", () => {
    const ids = HUB_SECTIONS.website
      .tabs({ ...owner, active: ["fixture-quote"] })
      .map((t) => t.id);
    expect(ids[0]).toBe("pages");
    expect(ids.at(-1)).toBe("fixture-quote");
  });

  it("composeMarketingTabs: contacts readers get Contacts, content readers Social; a grant-only member only granted add-ons", () => {
    const installed = [{ slug: "today-fixture", label: "Today fixture" }];
    expect(
      composeMarketingTabs({ installed, role: "editor", grants: [] }),
    ).toEqual([{ id: "social", label: "Social" }]);
    expect(
      composeMarketingTabs({
        installed,
        role: "staff",
        grants: ["today-fixture"],
      }).map((t) => t.id),
    ).toEqual(["contacts", "today-fixture"]);
  });

  it("Reports tabs: Site Report and Social; unknown lands on Site Report", () => {
    expect(REPORTS_TABS.map((t) => t.label)).toEqual(["Site Report", "Social"]);
    expect(resolveReportsTab("social")).toBe("social");
    expect(resolveReportsTab(["nope"])).toBe("site");
    expect(resolveReportsTab(undefined)).toBe("site");
    expect(reportsTabHref("social")).toBe("/hub/reports?tab=social");
    expect(
      HUB_SECTIONS.reports
        .tabs({ ...owner, role: "viewer", active: [] })
        .map((t) => t.id),
    ).toEqual(["site", "social"]);
    expect(
      HUB_SECTIONS.reports.tabs({ ...owner, role: "staff", active: [] }),
    ).toEqual([]);
  });

  it("tab counts equal groupCounts().byTab; add-on tabs count their own section", () => {
    const items = [
      item("legal:a", "settings", { tab: "legal" }),
      item("legal:b", "settings", { tab: "legal" }),
      item("email:r1", "settings", { tab: "email" }),
      item("today-fixture:a", "addon:today-fixture"),
    ];
    const settings = HUB_SECTIONS.settings.tabs({
      ...owner,
      active: [],
      needsYou: { items, failed: [] },
    });
    const byId = Object.fromEntries(settings.map((t) => [t.id, t.count]));
    expect(byId).toMatchObject({ legal: 2, email: 1 });
    expect(byId.billing).toBeUndefined();
    expect(byId.business).toBeUndefined();
    const marketing = HUB_SECTIONS.marketing.tabs({
      ...owner,
      active: ["today-fixture"],
      needsYou: { items, failed: [] },
    });
    expect(marketing.find((t) => t.id === "today-fixture")?.count).toBe(1);
    const failed = HUB_SECTIONS.settings.tabs({
      ...owner,
      active: [],
      needsYou: { items, failed: ["billing"] },
    });
    expect(failed.some((t) => t.count !== undefined)).toBe(false);
  });

  it("composeSectionTabs keys tabs by the sidebar hrefs the person sees", () => {
    const nav = composeHubNav({ ...owner, role: "viewer", active: [] });
    const map = composeSectionTabs({
      ...owner,
      role: "viewer",
      active: [],
      nav: nav.items,
    });
    expect(Object.keys(map)).toEqual([
      "/hub/today",
      "/hub/inbox",
      "/hub/website",
      "/hub/marketing",
      "/hub/reports",
      // 12-19: the pinned CDS Support row's tabs (support:read), no Get help for a Viewer.
      "/hub/support",
    ]);
    expect(map["/hub/support"]!.map((t) => t.id)).toEqual([
      "messages",
      "tickets",
      "documents",
      "ideas",
    ]);
    // 11-37: a Viewer's Marketing is Social only.
    expect(map["/hub/marketing"]!.map((t) => t.id)).toEqual(["social"]);
    expect(map["/hub/settings"]).toBeUndefined();
    expect(sectionForHref("/hub/settings?tab=billing")?.key).toBe("settings");
    expect(sectionForHref("/hub/setup")).toBeNull();
  });
});
