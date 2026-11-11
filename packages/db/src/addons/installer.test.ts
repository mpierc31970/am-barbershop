// Pure pieces of the installer (ADDON-04, ADDON-07). DB behaviour is covered by
// test/addons-install.integration.test.ts on the real PocketBase binary.
import { composeAddonRegistry } from "@cds/core/addons";
import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_CONFLICTS,
  FIXTURE_NEEDS,
  FIXTURE_QUOTE,
} from "../../../core/src/addons/__fixtures__/manifests";
import { SLUG_MAX } from "../content/pages";
import { getBillingGate, standInBillingGate } from "./billing";
import { seededOf } from "./entitlements";
import {
  activeConflict,
  missingRecipeSections,
  missingRequirements,
  pageDraftPrint,
  seededEqual,
  slugCandidates,
  SLUG_ATTEMPTS,
} from "./installer";

const registry = composeAddonRegistry(
  [FIXTURE_QUOTE, FIXTURE_NEEDS, FIXTURE_CONFLICTS],
  { fileExists: () => true },
);

describe("slugCandidates (CONTEXT A5-Q3)", () => {
  it("tries the slug, then -2 .. -20", () => {
    const c = slugCandidates("testimonials");
    expect(c).toHaveLength(SLUG_ATTEMPTS);
    expect(c[0]).toBe("testimonials");
    expect(c[1]).toBe("testimonials-2");
    expect(c[2]).toBe("testimonials-3");
    expect(c.at(-1)).toBe("testimonials-20");
  });

  it("keeps every candidate within the slug length limit", () => {
    const long = "a".repeat(SLUG_MAX);
    for (const s of slugCandidates(long).slice(1)) {
      expect(s.length).toBeLessThanOrEqual(SLUG_MAX);
      expect(s).toMatch(/^a+-\d+$/);
    }
  });

  it("never leaves a double hyphen when truncating", () => {
    const base = `${"b".repeat(SLUG_MAX - 3)}-cc`;
    for (const s of slugCandidates(base).slice(1)) {
      expect(s).not.toContain("--");
    }
  });
});

describe("seededOf records markers (A-CR-01)", () => {
  it("reads the count marker and the legacy id list, drops anything else", () => {
    expect(
      seededOf({
        records: {
          now: { count: 1500, at: "2026-09-28T00:00:00.000Z" },
          old: ["a", 7, "b"],
          bad: { count: -1 },
          junk: "x",
        },
      }).records,
    ).toEqual({
      now: { count: 1500, at: "2026-09-28T00:00:00.000Z" },
      old: ["a", "b"],
    });
  });

  it("keeps a 2000-record marker far under the 20000-byte ledger field", () => {
    const key = "k".repeat(100);
    const marker = { count: 2000, at: new Date().toISOString() };
    expect(JSON.stringify({ records: { [key]: marker } }).length).toBeLessThan(
      300,
    );
  });
});

describe("seeded page stage (A-WR-01)", () => {
  it("keeps pending: true only when stored as true", () => {
    expect(
      seededOf({ page: { id: "p1", slug: "q", pending: true } }).page,
    ).toEqual({ id: "p1", slug: "q", pending: true });
    expect(seededOf({ page: { id: "p1", slug: "q" } }).page).toEqual({
      id: "p1",
      slug: "q",
    });
    expect(
      seededOf({ page: { id: "p1", slug: "q", pending: "yes" } }).page,
    ).toEqual({ id: "p1", slug: "q" });
  });

  it("keeps a draft fingerprint only on a pending page, only as sha256 hex (R2-WR-02)", () => {
    const draft = "a".repeat(64);
    expect(
      seededOf({ page: { id: "p1", slug: "q", pending: true, draft } }).page,
    ).toEqual({ id: "p1", slug: "q", pending: true, draft });
    expect(seededOf({ page: { id: "p1", slug: "q", draft } }).page).toEqual({
      id: "p1",
      slug: "q",
    });
    expect(
      seededOf({ page: { id: "p1", slug: "q", pending: true, draft: "x" } })
        .page,
    ).toEqual({ id: "p1", slug: "q", pending: true });
  });

  it("pageDraftPrint ignores bookkeeping but sees every owner edit (R2-WR-02)", () => {
    const page = {
      id: "p1",
      title: "Quotes",
      slug: "quotes",
      status: "draft",
      updated: "2026-09-28 06:00:00.000Z",
      has_unpublished_changes: true,
    };
    const b1 = {
      id: "s1",
      section_type: "quote",
      content: { text: "" },
      sort_order: 1,
      updated: "t1",
    };
    const b2 = { ...b1, id: "s2", sort_order: 2 };
    const base = pageDraftPrint(page, [b1, b2]);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    // Bookkeeping and fetch order do not count.
    expect(
      pageDraftPrint(
        { ...page, updated: "later", has_unpublished_changes: false },
        [{ ...b2, updated: "t9" }, b1],
      ),
    ).toBe(base);
    // Owner edits do.
    expect(pageDraftPrint({ ...page, title: "Kind words" }, [b1, b2])).not.toBe(
      base,
    );
    expect(pageDraftPrint({ ...page, status: "published" }, [b1, b2])).not.toBe(
      base,
    );
    expect(pageDraftPrint(page, [b1])).not.toBe(base);
    expect(
      pageDraftPrint(page, [b1, { ...b2, content: { text: "mine" } }]),
    ).not.toBe(base);
    expect(
      pageDraftPrint(page, [
        { ...b1, sort_order: 2 },
        { ...b2, sort_order: 1 },
      ]),
    ).not.toBe(base);
  });

  it("missingRecipeSections saves only the blocks a partial run did not", () => {
    const recipe = [
      { section_type: "hero", content: {} },
      { section_type: "quote", content: {} },
      { section_type: "quote", content: { n: 2 } },
    ];
    expect(missingRecipeSections(recipe, [])).toEqual(recipe);
    expect(missingRecipeSections(recipe, ["hero"])).toEqual(recipe.slice(1));
    expect(missingRecipeSections(recipe, ["hero", "quote"])).toEqual([
      recipe[2],
    ]);
    expect(
      missingRecipeSections(recipe, ["quote", "hero", "quote", "text"]),
    ).toEqual([]);
  });
});

describe("seededEqual", () => {
  it("ignores key order", () => {
    expect(
      seededEqual(
        { page: { id: "p1", slug: "x" }, records: { k: ["a"] } },
        { records: { k: ["a"] }, page: { slug: "x", id: "p1" } },
      ),
    ).toBe(true);
  });

  it("sees a new page, a new records key or a changed id list", () => {
    expect(seededEqual({}, { page: { id: "p", slug: "s" } })).toBe(false);
    expect(seededEqual({ records: {} }, { records: { k: [] } })).toBe(false);
    expect(
      seededEqual({ records: { k: ["a"] } }, { records: { k: ["a", "b"] } }),
    ).toBe(false);
  });

  it("treats two empty ledgers as equal", () => {
    expect(seededEqual({}, {})).toBe(true);
  });
});

describe("requires and conflicts (ADDON-07)", () => {
  it("lists missing requirements in manifest order", () => {
    expect(missingRequirements(FIXTURE_NEEDS, new Set())).toEqual([
      "fixture-quote",
    ]);
    expect(
      missingRequirements(FIXTURE_NEEDS, new Set(["fixture-quote"])),
    ).toEqual([]);
  });

  it("finds an active conflict in both directions", () => {
    const quote = new Set(["fixture-quote"]);
    expect(activeConflict(registry, "fixture-conflicts", quote)).toBe(
      "fixture-quote",
    );
    expect(
      activeConflict(registry, "fixture-quote", new Set(["fixture-conflicts"])),
    ).toBe("fixture-conflicts");
    expect(activeConflict(registry, "fixture-needs", quote)).toBeUndefined();
  });
});

describe("BillingGate stand-in", () => {
  it("approves at no charge and logs the slug and org only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await standInBillingGate().approve({
      orgId: "org123",
      slug: "fixture-quote",
      actor: "owner@example.com",
      source: "hub",
    });
    expect(res).toEqual({ approved: true, chargeCents: 0 });
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line).toContain("fixture-quote");
    expect(line).toContain("org123");
    expect(line).not.toContain("owner@example.com");
    info.mockRestore();
  });

  it("getBillingGate returns the billing-backed gate", () => {
    expect(typeof getBillingGate().approve).toBe("function");
    expect(typeof getBillingGate().release).toBe("function");
  });
});
