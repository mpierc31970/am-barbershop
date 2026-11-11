// Help index (11-46; DASH-17, DASH-28, D285; T-11-46-01): per-person, grant-filtered help
// articles from the baked how-tos, and help id resolution for every screen's "?".
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { helpArticle } from "@cds/addon-registry/help";
import type { OrgRole } from "@cds/core";
import { PAID_CATEGORIES } from "@cds/core/support";
import { CORE_TRAINING } from "@cds/core/training";
import { describe, expect, it } from "vitest";
import {
  JUMP_INDEX_MAX,
  buildJumpIndex,
} from "../app/(platform)/hub/jump-index";
import { composeHubNav } from "../app/(platform)/hub/nav";
import { composeSectionTabs } from "../app/(platform)/hub/sections";
import {
  HELP_ALIASES,
  HELP_EXTRAS,
  buildHelpIndex,
  findHelpEntry,
  helpLinkFor,
  helpRouteHref,
  helpSearchText,
  jumpHelpEntries,
  resolveHelpId,
} from "../lib/help-index";

const ALL_ADDONS = ADDON_REGISTRY.list().map((m) => m.slug);
const who = (role: OrgRole, grants: string[] = []) => ({ role, grants });
const ids = (role: OrgRole, active: string[] = [], grants: string[] = []) =>
  buildHelpIndex(who(role, grants), active).map((e) => e.id);

const OWNER_ONLY = [
  "billing",
  "care-plan",
  "add-pages",
  "download-data",
  "media-storage",
  "quotes",
];
const OWNER_ADMIN = ["people-roles", "payments", "get-add-ons", "legal-copy"];

describe("buildHelpIndex (DASH-17, D285)", () => {
  it("Owner sees billing, add pages, download my data and people & roles", () => {
    const owner = ids("owner");
    for (const id of [...OWNER_ONLY, ...OWNER_ADMIN]) {
      expect(owner).toContain(id);
    }
  });

  it("Admin sees people and payments, never billing or buying articles", () => {
    const admin = ids("admin");
    for (const id of OWNER_ADMIN) expect(admin).toContain(id);
    for (const id of OWNER_ONLY) expect(admin).not.toContain(id);
  });

  it.each(["editor", "viewer"] as const)(
    "%s sees neither owner-only nor owner/admin articles",
    (role) => {
      const list = ids(role);
      for (const id of [...OWNER_ONLY, ...OWNER_ADMIN]) {
        expect(list).not.toContain(id);
      }
      expect(list).toContain("today");
      expect(list).toContain("pages");
    },
  );

  it("an add-on's article appears only while the add-on is active", () => {
    expect(ids("owner")).not.toContain("addon-testimonials");
    expect(ids("owner", ["testimonials"])).toContain("addon-testimonials");
    expect(ids("owner", ["credentials"])).not.toContain("addon-testimonials");
  });

  it("an Editor needs the add-on grant to see its article", () => {
    expect(ids("editor", ["testimonials"])).not.toContain("addon-testimonials");
    expect(ids("editor", ["testimonials"], ["testimonials"])).toContain(
      "addon-testimonials",
    );
  });

  it("every href is /hub/help/<id> and every entry has a baked article", () => {
    const list = buildHelpIndex(who("owner"), ALL_ADDONS);
    expect(list.length).toBeGreaterThan(50);
    for (const e of list) {
      expect(e.href).toBe(`/hub/help/${encodeURIComponent(e.id)}`);
      expect(helpArticle(e.howTo), e.howTo).not.toBeNull();
    }
    expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
  });

  it("never lists staff how-tos (T-11-45-01)", () => {
    const paths = buildHelpIndex(who("owner"), ALL_ADDONS).map((e) => e.howTo);
    for (const staff of [
      "docs/how-to/dashboard-staff-clis.md",
      "docs/how-to/theme-import.md",
      "docs/how-to/billing-staff-clis.md",
      "docs/how-to/monthly-site-email-job.md",
      "docs/how-to/staff-stage-and-announcements.md",
    ]) {
      expect(paths).not.toContain(staff);
    }
  });

  it("groups add-ons first, then the site, then setup (setup only when asked)", () => {
    const list = buildHelpIndex(who("owner"), ["testimonials"]);
    const groups = list.map((e) => e.group);
    expect(groups[0]).toBe("addons");
    expect(groups.lastIndexOf("addons")).toBeLessThan(groups.indexOf("site"));
    expect(groups.lastIndexOf("site")).toBeLessThan(groups.indexOf("setup"));
    expect(list.find((e) => e.id === "setup")?.group).toBe("setup");
    const live = buildHelpIndex(who("owner"), [], { includeSetup: false });
    expect(live.some((e) => e.group === "setup")).toBe(false);
  });

  it("help extras never collide with training ids", () => {
    const training = new Set(CORE_TRAINING.map((t) => t.id));
    for (const x of HELP_EXTRAS) expect(training.has(x.id)).toBe(false);
  });
});

describe("resolveHelpId / findHelpEntry", () => {
  it("maps screen help ids to articles", () => {
    expect(resolveHelpId("today")).toBe("today");
    expect(resolveHelpId("website.pages")).toBe("pages");
    expect(resolveHelpId("marketing.social")).toBe("social-accounts");
    expect(resolveHelpId("reports.social")).toBe("site-report");
    expect(resolveHelpId("settings.people")).toBe("people-roles");
    expect(resolveHelpId("website.testimonials")).toBe("addon-testimonials");
    expect(resolveHelpId("website.nope")).toBeNull();
    expect(resolveHelpId("")).toBeNull();
  });

  it("every alias target is a real article", () => {
    const all = new Set(
      buildHelpIndex(who("owner"), ALL_ADDONS).map((e) => e.id),
    );
    for (const target of Object.values(HELP_ALIASES)) {
      expect(all.has(target), target).toBe(true);
    }
  });

  it("every screen and tab help id an Owner can reach opens an article", () => {
    const input = {
      role: "owner" as const,
      grants: [],
      active: ALL_ADDONS,
      registry: ADDON_REGISTRY,
    };
    const nav = composeHubNav(input);
    const tabs = composeSectionTabs({ ...input, nav: nav.items });
    const helpIds = [
      "today",
      "inbox",
      "website",
      "marketing",
      "reports",
      "settings",
      "help",
      "support",
      "profile",
      "bell",
      ...Object.values(tabs).flatMap((t) => t.map((x) => x.helpId)),
    ];
    for (const id of helpIds) {
      expect(findHelpEntry(who("owner"), ALL_ADDONS, id), id).not.toBeNull();
    }
  });

  it("Today's links resolve: Google Business Profile, support", () => {
    expect(
      findHelpEntry(who("viewer"), [], "google-business-profile"),
    ).not.toBeNull();
    expect(findHelpEntry(who("viewer"), [], "support")).not.toBeNull();
  });

  it("a Viewer opening an owner-only article gets nothing (404)", () => {
    expect(findHelpEntry(who("viewer"), [], "download-data")).toBeNull();
    expect(findHelpEntry(who("admin"), [], "settings.billing")).toBeNull();
    expect(findHelpEntry(who("owner"), [], "download-data")).not.toBeNull();
    expect(findHelpEntry(who("owner"), [], "website.testimonials")).toBeNull();
  });
});

describe("help helpers", () => {
  it("every Owner screen and help article fits in Jump to (DASH-28)", () => {
    const input = {
      role: "owner" as const,
      grants: [],
      active: ALL_ADDONS,
      registry: ADDON_REGISTRY,
    };
    const nav = composeHubNav({ ...input, stage: "being_built" });
    const help = jumpHelpEntries(buildHelpIndex(who("owner"), ALL_ADDONS));
    const idx = buildJumpIndex({
      nav,
      sections: composeSectionTabs({ ...input, nav: nav.items }),
      help,
    });
    expect(idx.length).toBeLessThan(JUMP_INDEX_MAX);
    expect(idx.filter((e) => e.group === "Help articles").length).toBe(
      help.length,
    );
  });

  it("helpRouteHref keeps plain hub routes only", () => {
    expect(helpRouteHref("/hub/settings?tab=billing")).toBe(
      "/hub/settings?tab=billing",
    );
    expect(helpRouteHref("/hub/today")).toBe("/hub/today");
    expect(helpRouteHref("terminal: npm run org:stage")).toBeNull();
    expect(helpRouteHref("/hub/settings/quotes/<id>")).toBeNull();
    expect(helpRouteHref("/hub/help/google-business-profile (x)")).toBeNull();
    expect(helpRouteHref("https://evil.example/hub")).toBeNull();
  });

  it("helpLinkFor links only articles the person may read", () => {
    const viewer = helpLinkFor(buildHelpIndex(who("viewer"), []));
    expect(viewer("profile-and-alerts.md")).toBe("/hub/help/profile");
    expect(viewer("download-my-data.md")).toBeNull();
    expect(viewer("dashboard-staff-clis.md")).toBeNull();
    const owner = helpLinkFor(buildHelpIndex(who("owner"), []));
    expect(owner("download-my-data.md#steps")).toBe("/hub/help/download-data");
  });

  it("search text holds the steps in plain lower case", () => {
    const today = buildHelpIndex(who("owner"), []).find(
      (e) => e.id === "today",
    )!;
    const text = helpSearchText(today);
    expect(text).toContain("customize today");
    expect(text).not.toMatch(/[*`]/);
  });
});

describe("P12 Support help (12-33; SUPPORT-01, D110)", () => {
  const ROLES: readonly OrgRole[] = ["owner", "admin", "editor", "viewer"];
  const P12_IDS = [
    "support.messages",
    "support.get-help",
    "support.follow-ticket",
    "support.documents",
    "support.ideas",
    "service-notices",
    "paid-services",
    "what-support-includes",
  ];

  it.each(ROLES)(
    "What support includes is listed and opens for a %s",
    (role) => {
      expect(ids(role)).toContain("what-support-includes");
      const entry = findHelpEntry(who(role), [], "what-support-includes");
      expect(entry?.href).toBe("/hub/help/what-support-includes");
      expect(entry?.audience).toBe("all");
      const text = helpSearchText(entry!);
      expect(text).toContain("support replies within 2 business days.");
      for (const area of [
        "anything support built",
        "domain and dns",
        "google business profile",
        "restore from backup",
        "account and billing",
        "dmca",
      ]) {
        expect(text, area).toContain(area);
      }
    },
  );

  it("every P12 article is a baked, readable help entry for every role", () => {
    for (const role of ROLES) {
      for (const id of P12_IDS) {
        expect(findHelpEntry(who(role), [], id)?.id, `${role} ${id}`).toBe(id);
      }
    }
  });

  it("dotted training ids resolve to themselves; support.tickets aliases the ticket how-to", () => {
    expect(resolveHelpId("support.messages")).toBe("support.messages");
    expect(resolveHelpId("support.follow-ticket")).toBe(
      "support.follow-ticket",
    );
    expect(resolveHelpId("support.tickets")).toBe("support.follow-ticket");
    // An unknown dotted id still goes through the add-on rule (no article).
    expect(resolveHelpId("support.nope")).toBeNull();
  });

  it("each Support tab and the Get help jump entry open their own P12 article", () => {
    const input = {
      role: "owner" as const,
      grants: [],
      active: ALL_ADDONS,
      registry: ADDON_REGISTRY,
    };
    const nav = composeHubNav(input);
    const support = composeSectionTabs({ ...input, nav: nav.items })[
      "/hub/support"
    ]!;
    const byId = Object.fromEntries(support.map((t) => [t.id, t.helpId]));
    expect(byId).toEqual({
      messages: "support.messages",
      tickets: "support.follow-ticket",
      documents: "support.documents",
      ideas: "support.ideas",
      "get-help": "support.get-help",
    });
  });

  it("every paid category's Show me how resolves for every role that sees the panel (WR-B01)", () => {
    for (const role of ["owner", "admin", "editor", "viewer"] as const) {
      for (const c of PAID_CATEGORIES) {
        expect(
          findHelpEntry(who(role), [], c.helpId),
          `${role} ${c.key} -> ${c.helpId}`,
        ).not.toBeNull();
      }
    }
  });

  it("staff support CLIs never reach a tenant's Help (T-12-33-01)", () => {
    const viewer = helpLinkFor(buildHelpIndex(who("owner"), ALL_ADDONS));
    expect(viewer("support-staff-clis.md")).toBeNull();
    expect(helpArticle("docs/how-to/support-staff-clis.md")).toBeNull();
  });
});

describe("P13 help (13-50; STAFF-21, STAFF-22, T-13-50-01)", () => {
  const ROLES: readonly OrgRole[] = ["owner", "admin", "editor", "viewer"];

  it.each(["owner", "editor"] as const)(
    "a %s finds Rate a resolved ticket and Content notices and suspension",
    (role) => {
      expect(ids(role)).toEqual(
        expect.arrayContaining(["support.rating", "site-suspension"]),
      );
      expect(findHelpEntry(who(role), [], "support.rating")?.href).toBe(
        "/hub/help/support.rating",
      );
      expect(findHelpEntry(who(role), [], "site-suspension")?.audience).toBe(
        "all",
      );
    },
  );

  it.each(ROLES)(
    "no %s help entry is a staff how-to or a /staff route",
    (role) => {
      const entries = buildHelpIndex(who(role, []), ALL_ADDONS);
      for (const e of entries) {
        expect(e.howTo, e.id).not.toMatch(/\/staff-|media-staff-tools/);
        expect(helpArticle(e.howTo)?.route ?? "", e.id).not.toMatch(
          /^\/staff\b/,
        );
      }
    },
  );

  it("the public report page has no help entry", () => {
    for (const role of ROLES) {
      expect(
        buildHelpIndex(who(role), ALL_ADDONS).map((e) => e.howTo),
      ).not.toContain("docs/how-to/report-a-problem.md");
    }
  });
});

describe("P14 help (14-46; DOM-02, DOM-03, DOM-07, DOM-10, LIFE-01, ONB-10, T-14-46-01)", () => {
  const OWNER_ADMIN_P14 = [
    "connect-your-domain",
    "add-a-dns-record",
    "set-up-email-for-your-domain",
    "email-address",
    "review-your-site-before-launch",
  ];

  it("an Owner finds every P14 article", () => {
    expect(ids("owner")).toEqual(
      expect.arrayContaining([
        ...OWNER_ADMIN_P14,
        "preview-links",
        "leaving-cds",
      ]),
    );
  });

  it("an Admin reads the domain, email and review articles but not Moving away", () => {
    const admin = ids("admin");
    expect(admin).toEqual(expect.arrayContaining(OWNER_ADMIN_P14));
    expect(admin).not.toContain("leaving-cds");
    expect(findHelpEntry(who("admin"), [], "leaving-cds")).toBeNull();
  });

  it.each(["editor", "viewer"] as const)(
    "a %s sees only Preview links of the P14 articles",
    (role) => {
      const got = ids(role);
      expect(got).toContain("preview-links");
      for (const id of [...OWNER_ADMIN_P14, "leaving-cds"]) {
        expect(got).not.toContain(id);
      }
    },
  );

  it("the Domain, Integrations and Review help ids resolve to their how-tos", () => {
    expect(resolveHelpId("settings.domain")).toBe("connect-your-domain");
    expect(resolveHelpId("settings.integrations")).toBe("connect-your-domain");
    expect(resolveHelpId("review")).toBe("review-your-site-before-launch");
    expect(findHelpEntry(who("owner"), [], "settings.domain")?.howTo).toBe(
      "docs/how-to/connect-your-domain.md",
    );
    expect(findHelpEntry(who("admin"), [], "review")?.id).toBe(
      "review-your-site-before-launch",
    );
    expect(findHelpEntry(who("owner"), [], "leaving-cds")?.href).toBe(
      "/hub/help/leaving-cds",
    );
  });

  it("email-address is one entry (training, not an extra)", () => {
    expect(HELP_EXTRAS.map((e) => e.id)).not.toContain("email-address");
    expect(ids("owner").filter((id) => id === "email-address")).toHaveLength(1);
  });

  it("no P14 article carries a staff route", () => {
    for (const id of [...OWNER_ADMIN_P14, "preview-links", "leaving-cds"]) {
      const e = findHelpEntry(who("owner"), [], id);
      expect(e, id).not.toBeNull();
      expect(helpArticle(e!.howTo)?.route ?? "", id).not.toMatch(/^\/staff/);
    }
  });
});
