// 11-47 (DASH-17, DASH-25; D-UI-P11-16): every screen's "?" opens a real how-to for the
// person who sees it, and every hub screen renders ScreenHeader (one "?" beside its H1).
//   - Every HUB_SECTIONS item and every tab a role can see has a helpId that resolves to a
//     Help entry that role may read (findHelpEntry, the same check as /hub/api/help/<id>).
//   - A filesystem scan: each app/(platform)/hub/**/page.tsx renders ScreenHeader itself or
//     through its listed frame component, except the listed redirect-only / focused frames.
//   - AddonTabHeader draws no "?" of its own.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ADDON_REGISTRY } from "@cds/addon-registry";
import type { OrgRole } from "@cds/core";
import { describe, expect, it } from "vitest";
import { composeHubNav } from "../app/(platform)/hub/nav";
import {
  HUB_SECTIONS,
  composeSectionTabs,
} from "../app/(platform)/hub/sections";
import { findHelpEntry } from "../lib/help-index";

const ALL_ADDONS = ADDON_REGISTRY.list().map((m) => m.slug);
const ROLES: readonly OrgRole[] = ["owner", "admin", "editor", "viewer"];

describe("helpIds resolve (DASH-17)", () => {
  for (const role of ROLES) {
    it(`every section and tab a ${role} sees opens an article they may read`, () => {
      const subject = { role, grants: [] as string[] };
      const input = {
        role,
        grants: [] as string[],
        active: ALL_ADDONS,
        registry: ADDON_REGISTRY,
      };
      const nav = composeHubNav(input);
      const tabs = composeSectionTabs({ ...input, nav: nav.items });
      const ids = Object.values(tabs).flatMap((t) => t.map((x) => x.helpId));
      for (const id of ids) {
        expect(findHelpEntry(subject, ALL_ADDONS, id), id).not.toBeNull();
      }
    });
  }

  it("every HUB_SECTIONS item helpId resolves (Owner)", () => {
    for (const s of Object.values(HUB_SECTIONS)) {
      expect(
        findHelpEntry({ role: "owner", grants: [] }, ALL_ADDONS, s.helpId),
        s.helpId,
      ).not.toBeNull();
    }
  });

  it("the other screens' help ids resolve: add-ons, setup, profile, builder", () => {
    const owner = { role: "owner" as const, grants: [] };
    for (const id of ["add-ons", "setup", "profile", "website.pages"]) {
      expect(findHelpEntry(owner, ALL_ADDONS, id), id).not.toBeNull();
    }
    // An added add-on's detail page opens that add-on's own how-to.
    for (const m of ADDON_REGISTRY.list()) {
      if (m.training.length === 0) continue;
      expect(
        findHelpEntry(owner, ALL_ADDONS, `add-ons.${m.slug}`)?.id,
        m.slug,
      ).toBe(m.training[0]!.id);
    }
  });
});

const HUB_DIR = join(__dirname, "..", "app", "(platform)", "hub");

/** Pages without a "?" header, and why (11-47 choice 4; own-header frames use FrameTitle). */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  "page.tsx": "redirect only (/hub -> Today or setup)",
  "declined/page.tsx": "focused declined frame (10-32)",
  "checkout/return/page.tsx": "payment return status, focused",
  "website/pages/[pageId]/page.tsx":
    "builder: the page header carries ScreenHelp beside the page title",
  "website/pages/[pageId]/preview/page.tsx": "bare preview, no hub chrome",
};

/** Pages whose header is drawn by a frame component in another file. */
const FRAMES: Readonly<Record<string, readonly string[]>> = {
  "settings/page.tsx": ["settings/SettingsPanels.tsx"],
  "settings/quotes/[id]/page.tsx": ["settings/SettingsPanels.tsx"],
  "setup/page.tsx": ["setup/SetupOverview.tsx"],
  "setup/[stage]/page.tsx": ["setup/[stage]/StageFrame.tsx"],
  "support/page.tsx": ["support/SupportFrame.tsx"],
  "help/[id]/page.tsx": [
    "../../../../../packages/ui/src/hub/help/HelpArticle.tsx",
  ],
};

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "api") continue;
      out.push(...pages(full));
    } else if (name === "page.tsx") {
      out.push(relative(HUB_DIR, full).split(sep).join("/"));
    }
  }
  return out;
}

const read = (rel: string) => readFileSync(join(HUB_DIR, rel), "utf8");

describe("every hub screen renders ScreenHeader (D-UI-P11-16)", () => {
  const all = pages(HUB_DIR);

  it("finds the hub pages", () => {
    expect(all).toContain("today/page.tsx");
    expect(all.length).toBeGreaterThan(15);
  });

  for (const rel of all) {
    if (Object.hasOwn(EXCEPTIONS, rel)) continue;
    it(rel, () => {
      const files = [rel, ...(FRAMES[rel] ?? [])];
      expect(
        files.some((f) => /<(ScreenHeader|FrameTitle)\b/.test(read(f))),
        `${rel} renders no ScreenHeader or FrameTitle`,
      ).toBe(true);
    });
  }

  it("every exception is still a real page", () => {
    for (const rel of Object.keys(EXCEPTIONS)) expect(all).toContain(rel);
  });

  it("the builder header carries the one ?", () => {
    expect(read("website/pages/[pageId]/Builder.tsx")).toMatch(/<ScreenHelp\b/);
  });

  it("AddonTabHeader draws no ? of its own", () => {
    const src = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "packages",
        "ui",
        "src",
        "hub",
        "AddonTabHeader.tsx",
      ),
      "utf8",
    );
    expect(src).not.toMatch(/CircleHelp/);
  });

  it("section tab bars read HUB_SECTIONS (DASH-25)", () => {
    for (const rel of [
      "inbox/page.tsx",
      "website/page.tsx",
      "marketing/page.tsx",
      "reports/page.tsx",
      "settings/page.tsx",
      "settings/quotes/[id]/page.tsx",
    ]) {
      expect(read(rel), rel).toMatch(/HUB_SECTIONS\.\w+\s*\.tabs\(/);
    }
  });
});
