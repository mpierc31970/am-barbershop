// Jump-to index (11-14; DASH-28, D285): built on the server from the grant-filtered nav and
// HUB_SECTIONS tabs plus help entries; never holds a screen the person cannot see.
import { composeAddonRegistry } from "@cds/core/addons";
import type { JumpEntry as UiJumpEntry } from "@cds/ui/hub/shell";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_QUOTE,
  todayFixture,
} from "../../../packages/core/src/addons/__fixtures__/manifests";
import {
  JUMP_INDEX_MAX,
  buildJumpIndex,
} from "../app/(platform)/hub/jump-index";
import { composeHubNav } from "../app/(platform)/hub/nav";
import { composeSectionTabs } from "../app/(platform)/hub/sections";

const registry = composeAddonRegistry([FIXTURE_QUOTE, todayFixture], {
  fileExists: () => true,
});

function indexFor(
  role: "owner" | "admin" | "editor" | "viewer" | "staff",
  help: { id: string; title: string; href: string }[] = [],
  grants: string[] = [],
  active: string[] = [],
) {
  const input = { role, grants, active, registry };
  const nav = composeHubNav(input);
  const sections = composeSectionTabs({ ...input, nav: nav.items });
  return buildJumpIndex({ nav, sections, help });
}

describe("buildJumpIndex (DASH-28)", () => {
  it("Owner: screens in sidebar order with their tabs; includes Settings › Billing", () => {
    const idx = indexFor("owner");
    expect(idx[0]).toEqual({
      group: "Screens",
      label: "Today",
      href: "/hub/today",
      keywords: "",
      path: "Today",
    });
    const billing = idx.find((e) => e.path === "Settings › Billing");
    expect(billing).toMatchObject({
      group: "Screens",
      label: "Billing",
      href: "/hub/settings?tab=billing",
    });
    expect(idx.some((e) => e.path === "Website › Pages")).toBe(true);
    expect(idx.some((e) => e.href === "/hub/add-ons")).toBe(true);
    // A&M fork: no CDS Support anywhere.
    expect(idx.some((e) => e.label === "CDS Support")).toBe(false);
    // Website comes before its tabs, and Settings after Reports (sidebar order).
    const at = (href: string) => idx.findIndex((e) => e.href === href);
    expect(at("/hub/website")).toBeLessThan(at("/hub/website?tab=pages"));
    expect(at("/hub/reports")).toBeLessThan(at("/hub/settings"));
  });

  it("Viewer: no Settings, no billing, no Get add-ons", () => {
    const idx = indexFor("viewer");
    expect(idx.some((e) => e.href.startsWith("/hub/settings"))).toBe(false);
    expect(idx.some((e) => /billing/i.test(e.href + e.label))).toBe(false);
    expect(idx.some((e) => e.href === "/hub/add-ons")).toBe(false);
    expect(idx.some((e) => e.href === "/hub/reports?tab=site")).toBe(true);
  });

  it("an add-on tab appears only while active and readable", () => {
    expect(
      indexFor("owner", [], [], ["today-fixture"]).some(
        (e) => e.href === "/hub/marketing?tab=today-fixture",
      ),
    ).toBe(true);
    expect(
      indexFor("owner").some((e) => e.href.includes("today-fixture")),
    ).toBe(false);
  });

  it("help entries follow screens; an empty help list works; off-hub hrefs are dropped", () => {
    expect(indexFor("owner", []).every((e) => e.group === "Screens")).toBe(
      true,
    );
    const idx = indexFor("owner", [
      { id: "billing", title: "Paying your bill", href: "/hub/help/billing" },
      { id: "evil", title: "Elsewhere", href: "https://example.com" },
    ]);
    const help = idx.filter((e) => e.group === "Help articles");
    expect(help).toEqual([
      {
        group: "Help articles",
        label: "Paying your bill",
        href: "/hub/help/billing",
        keywords: "billing",
        path: "Help",
      },
    ]);
    expect(idx.at(-1)?.group).toBe("Help articles");
  });

  it("never more than 250 entries, de-duplicated by href", () => {
    const help = Array.from({ length: 500 }, (_, i) => ({
      id: `a${i}`,
      title: `Article ${i}`,
      href: `/hub/help/a${i % 300}`,
    }));
    const idx = indexFor("owner", help);
    expect(JUMP_INDEX_MAX).toBe(250);
    expect(idx.length).toBe(250);
    expect(new Set(idx.map((e) => e.href)).size).toBe(idx.length);
  });

  it("A&M fork: no CDS Support screen, tabs or Get help in Jump to", () => {
    for (const role of ["owner", "viewer"] as const) {
      const idx = indexFor(role);
      expect(idx.some((e) => e.href.startsWith("/hub/support"))).toBe(false);
    }
  });

  it("entries fit the JumpToDialog's JumpEntry (11-15)", () => {
    const entries: UiJumpEntry[] = indexFor("owner");
    expect(entries.length).toBeGreaterThan(0);
  });
});
