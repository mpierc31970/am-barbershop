import { describe, expect, it } from "vitest";
import type { SectionTypeDefinition } from "../content/registry";
import { CORE_SECTIONS } from "../content/registry";
import { fixtureAddonSection } from "../content/__fixtures__/fixture-addon";
import { CORE_TRAINING } from "../../training/entries";
import {
  FIXTURE_CONFLICTS,
  FIXTURE_HOW_TO,
  FIXTURE_NEEDS,
  FIXTURE_PRIVATE,
  FIXTURE_QUOTE,
  fixtureManifest,
} from "./__fixtures__/manifests";
import { composeAddonRegistry } from "./compose";
import { AddonManifestError } from "./errors";
import { trainingForActive } from "./training";
import type { AddonManifest, AddonNav } from "./types";

const files = new Set([FIXTURE_HOW_TO, "docs/runbooks/fixture-premium.md"]);
const opts = { fileExists: (p: string) => files.has(p) };
const compose = (ms: readonly AddonManifest[]) =>
  composeAddonRegistry(ms, opts);

function refuses(ms: readonly AddonManifest[], pattern: RegExp): void {
  let err: unknown;
  try {
    compose(ms);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AddonManifestError);
  expect((err as Error).message).toMatch(pattern);
}

describe("composeAddonRegistry: lookup", () => {
  const reg = compose([FIXTURE_PRIVATE, FIXTURE_QUOTE]);

  it("list() is sorted by order then slug", () => {
    expect(reg.list().map((m) => m.slug)).toEqual([
      "fixture-quote",
      "fixture-private",
    ]);
  });

  it("list() sorts equal orders by slug", () => {
    const r = compose([
      fixtureManifest({ slug: "fixture-b", order: 1 }),
      fixtureManifest({ slug: "fixture-a", order: 1 }),
    ]);
    expect(r.list().map((m) => m.slug)).toEqual(["fixture-a", "fixture-b"]);
  });

  it("publicList() excludes private add-ons (ADDON-09)", () => {
    expect(reg.publicList().map((m) => m.slug)).toEqual(["fixture-quote"]);
  });

  it("get() returns a composed manifest", () => {
    expect(reg.get("fixture-quote")).toBe(FIXTURE_QUOTE);
    expect(reg.get("fixture-private")).toBe(FIXTURE_PRIVATE);
  });

  it("get() refuses non-strings and prototype keys", () => {
    expect(reg.get(42)).toBeUndefined();
    expect(reg.get(undefined)).toBeUndefined();
    expect(reg.get("__proto__")).toBeUndefined();
    expect(reg.get("constructor")).toBeUndefined();
    expect(reg.get("toString")).toBeUndefined();
  });

  it("sections() and ownerOf() map add-on section types", () => {
    expect(reg.sections().map((s) => s.type)).toContain("fixture-quote");
    expect(reg.ownerOf("fixture-quote")).toBe("fixture-quote");
    expect(reg.ownerOf("hero")).toBeUndefined();
    expect(reg.ownerOf(7)).toBeUndefined();
    expect(reg.ownerOf("__proto__")).toBeUndefined();
  });

  it("the registry is frozen", () => {
    expect(Object.isFrozen(reg)).toBe(true);
    expect(Object.isFrozen(reg.list())).toBe(true);
  });
});

describe("composeAddonRegistry: requires and conflicts", () => {
  const reg = compose([FIXTURE_QUOTE, FIXTURE_NEEDS, FIXTURE_CONFLICTS]);

  it("dependentsOf lists add-ons that require the slug", () => {
    expect(reg.dependentsOf("fixture-quote")).toEqual(["fixture-needs"]);
    expect(reg.dependentsOf("fixture-needs")).toEqual([]);
  });

  it("conflictsOf is symmetric", () => {
    expect(reg.conflictsOf("fixture-conflicts")).toEqual(["fixture-quote"]);
    expect(reg.conflictsOf("fixture-quote")).toEqual(["fixture-conflicts"]);
    expect(reg.conflictsOf("unknown")).toEqual([]);
  });
});

describe("composeAddonRegistry: refusals (CONTEXT A3-Q1)", () => {
  it("refuses a bad manifest shape", () => {
    refuses([fixtureManifest({ slug: "Bad" })], /slug/);
  });

  it("refuses a duplicate slug", () => {
    refuses([FIXTURE_QUOTE, FIXTURE_QUOTE], /fixture-quote.*duplicate/);
  });

  it("refuses requires of an unknown slug", () => {
    refuses(
      [fixtureManifest({ slug: "fixture-a", requires: ["fixture-nope"] })],
      /fixture-a.*requires.*unknown.*fixture-nope/,
    );
  });

  it("refuses conflicts with an unknown slug", () => {
    refuses(
      [fixtureManifest({ slug: "fixture-a", conflicts: ["fixture-nope"] })],
      /fixture-a.*conflicts.*unknown.*fixture-nope/,
    );
  });

  it("refuses requiring itself", () => {
    refuses(
      [fixtureManifest({ slug: "fixture-a", requires: ["fixture-a"] })],
      /fixture-a.*requires itself/,
    );
  });

  it("refuses conflicting with itself", () => {
    refuses(
      [fixtureManifest({ slug: "fixture-a", conflicts: ["fixture-a"] })],
      /fixture-a.*conflicts with itself/,
    );
  });

  it("refuses a requires cycle", () => {
    refuses(
      [
        fixtureManifest({ slug: "fixture-a", requires: ["fixture-b"] }),
        fixtureManifest({ slug: "fixture-b", requires: ["fixture-a"] }),
      ],
      /cycle/,
    );
  });

  it("refuses a longer requires cycle", () => {
    refuses(
      [
        fixtureManifest({ slug: "fixture-a", requires: ["fixture-b"] }),
        fixtureManifest({ slug: "fixture-b", requires: ["fixture-c"] }),
        fixtureManifest({ slug: "fixture-c", requires: ["fixture-a"] }),
      ],
      /cycle/,
    );
  });

  it("refuses a slug both required and conflicting", () => {
    refuses(
      [
        FIXTURE_QUOTE,
        fixtureManifest({
          slug: "fixture-a",
          requires: ["fixture-quote"],
          conflicts: ["fixture-quote"],
        }),
      ],
      /fixture-a.*both requires and conflicts/,
    );
  });

  it("refuses a section type not prefixed by the slug", () => {
    const def: SectionTypeDefinition = {
      ...fixtureAddonSection,
      type: "quote-x",
    };
    refuses(
      [fixtureManifest({ slug: "fixture-quote", sections: [def] })],
      /fixture-quote.*quote-x.*prefixed/,
    );
  });

  it("refuses a section type colliding with core", () => {
    const hero = CORE_SECTIONS.find((s) => s.type === "hero")!;
    refuses([fixtureManifest({ slug: "hero", sections: [hero] })], /hero/);
  });

  it("refuses a section type colliding with a core type passed in options", () => {
    const def: SectionTypeDefinition = {
      ...fixtureAddonSection,
      type: "fixture-a-block",
    };
    expect(() =>
      composeAddonRegistry(
        [fixtureManifest({ slug: "fixture-a", sections: [def] })],
        { ...opts, coreSections: [def] },
      ),
    ).toThrow(/fixture-a.*section/);
  });

  it("refuses empty training", () => {
    refuses(
      [fixtureManifest({ slug: "fixture-a", training: [] })],
      /fixture-a.*training/,
    );
  });

  it("refuses a training how-to that does not exist", () => {
    refuses(
      [
        fixtureManifest({
          slug: "fixture-a",
          training: [
            {
              id: "fixture-a",
              title: "A",
              requirement: "ADDON-11",
              kind: "feature",
              howTo: "docs/how-to/missing.md",
              video: null,
            },
          ],
        }),
      ],
      /fixture-a.*docs\/how-to\/missing\.md/,
    );
  });

  it("refuses an unknown nav target", () => {
    const nav = {
      placement: "tab",
      item: "shop",
      label: "X",
      icon: "Globe",
    } as unknown as AddonNav;
    refuses([fixtureManifest({ slug: "fixture-a", nav })], /fixture-a.*nav/);
  });

  it("refuses a collection whose feature is not addon:<slug>", () => {
    refuses(
      [
        fixtureManifest({
          slug: "fixture-a",
          collections: {
            fixture_a_rows: {
              kind: "base",
              feature: "members",
              export: ["id"],
              writes: "generic",
            },
          },
        }),
      ],
      /fixture-a.*fixture_a_rows.*addon:fixture-a/,
    );
  });

  describe("a public collection is readable by visitors (A-WR-09)", () => {
    const rules = {
      singular: "row",
      plural: "rows",
      validate: (raw: unknown) => raw as Record<string, unknown>,
      textsOf: () => [],
      urlsOf: () => [],
      title: () => "",
      publishedField: "is_published" as const,
      orderField: "sort_order" as const,
    };
    const withPublic = (
      exported: readonly string[],
      records: AddonManifest["records"] = { fixture_a_rows: rules },
    ) =>
      fixtureManifest({
        slug: "fixture-a",
        collections: {
          fixture_a_rows: {
            kind: "base",
            feature: "addon:fixture-a",
            export: exported,
            writes: "custom",
            public: ["id", "title"],
          },
        },
        records,
      });

    it("needs record rules", () => {
      refuses(
        [withPublic(["id", "title", "is_published", "sort_order"], {})],
        /fixture-a.*public collection fixture_a_rows needs record rules/,
      );
    });

    it("needs is_published and sort_order", () => {
      refuses(
        [withPublic(["id", "title", "sort_order"])],
        /fixture-a.*must export is_published/,
      );
      refuses(
        [withPublic(["id", "title", "is_published"])],
        /fixture-a.*must export sort_order/,
      );
    });

    it("composes with both", () => {
      expect(() =>
        compose([withPublic(["id", "title", "is_published", "sort_order"])]),
      ).not.toThrow();
    });
  });
});

describe("trainingForActive (ADDON-11)", () => {
  const reg = compose([FIXTURE_QUOTE, FIXTURE_NEEDS]);

  it("returns core plus active add-on training", () => {
    expect(trainingForActive(CORE_TRAINING, reg, ["fixture-quote"])).toEqual([
      ...CORE_TRAINING,
      ...FIXTURE_QUOTE.training,
    ]);
  });

  it("returns core only when nothing is active", () => {
    expect(trainingForActive(CORE_TRAINING, reg, [])).toEqual([
      ...CORE_TRAINING,
    ]);
  });

  it("ignores unknown active slugs and follows registry order", () => {
    expect(
      trainingForActive(CORE_TRAINING, reg, [
        "fixture-needs",
        "nope",
        "fixture-quote",
      ]),
    ).toEqual([
      ...CORE_TRAINING,
      ...FIXTURE_QUOTE.training,
      ...FIXTURE_NEEDS.training,
    ]);
  });
});

describe("composeAddonRegistry: privacy clause ids (WR-B06)", () => {
  const clause = {
    id: "shared-data",
    heading: "Shared data",
    what: "Names visitors type into the form.",
    why: "To reply to them.",
    howLong: "Until the business deletes them.",
  };

  it("refuses two add-ons that declare the same privacy clause id", () => {
    refuses(
      [
        { ...FIXTURE_QUOTE, privacyClauses: [clause] },
        { ...FIXTURE_PRIVATE, privacyClauses: [clause] },
      ],
      /privacy clause id "shared-data" is also used by/,
    );
  });

  it("accepts distinct ids across add-ons", () => {
    expect(() =>
      compose([
        { ...FIXTURE_QUOTE, privacyClauses: [clause] },
        {
          ...FIXTURE_PRIVATE,
          privacyClauses: [{ ...clause, id: "other-data" }],
        },
      ]),
    ).not.toThrow();
  });
});
