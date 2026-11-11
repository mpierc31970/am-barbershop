import { describe, expect, it } from "vitest";
import { CORE_ENTITLEMENTS } from "../payments/entitlements";
import { NAV_TARGETS, RESERVED_ADDON_SLUGS } from "./constants";
import { composeAddonRegistry } from "./compose";
import { defineAddon } from "./define";
import { AddonManifestError } from "./errors";
import { fixtureManifest, todayFixture } from "./__fixtures__/manifests";
import type { AddonManifest, AddonNav } from "./types";

function manifest(overrides: Record<string, unknown> = {}): AddonManifest {
  return {
    slug: "sample-addon",
    name: "Sample",
    summary: "A sample add-on.",
    category: "content",
    version: "1.0.0",
    order: 10,
    visibility: "public",
    paths: ["standard"],
    requires: [],
    conflicts: [],
    nav: { placement: "tab", item: "website", label: "Sample", icon: "Globe" },
    sections: [],
    collections: {},
    records: {},
    install: {},
    uninstall: { retain: "all" },
    training: [],
    ...overrides,
  } as AddonManifest;
}

describe("defineAddon", () => {
  it("returns the same object for a valid manifest", () => {
    const m = manifest();
    expect(defineAddon(m)).toBe(m);
  });

  it('accepts a manifest-only add-on (nav.placement "none", 10-07)', () => {
    const m = manifest({
      nav: {
        placement: "none",
        label: "Sample",
        icon: "Globe",
        unlocks: "Pro features in Forms",
      },
    });
    expect(defineAddon(m)).toBe(m);
  });

  const bad: [string, Record<string, unknown>][] = [
    ["slug Bad", { slug: "Bad" }],
    ["reserved slug core", { slug: "core" }],
    ["core entitlement slug care-plan (WR-B03)", { slug: "care-plan" }],
    ["core entitlement slug media-pack (WR-B03)", { slug: "media-pack" }],
    ["visibility secret", { visibility: "secret" }],
    ["unknown path mars", { paths: ["mars"] }],
    [
      "unknown icon Rocket",
      {
        nav: { placement: "tab", item: "website", label: "x", icon: "Rocket" },
      },
    ],
    ["uninstall retain none", { uninstall: { retain: "none" } }],
    [
      "unknown placement floating",
      { nav: { placement: "floating", label: "x", icon: "Globe" } },
    ],
    [
      "placement none without unlocks",
      { nav: { placement: "none", label: "x", icon: "Globe" } },
    ],
    [
      "placement none with an unknown icon",
      {
        nav: { placement: "none", label: "x", icon: "Rocket", unlocks: "y" },
      },
    ],
    ["requires not an array", { requires: "fixture" }],
  ];

  for (const [name, overrides] of bad) {
    it(`throws AddonManifestError: ${name}`, () => {
      expect(() => defineAddon(manifest(overrides))).toThrow(
        AddonManifestError,
      );
    });
  }

  it("names the slug and the field in the message", () => {
    expect(() => defineAddon(manifest({ visibility: "secret" }))).toThrow(
      /sample-addon.*visibility/,
    );
  });

  it("AddonManifestError carries code addon_manifest_invalid", () => {
    try {
      defineAddon(manifest({ slug: "hub" }));
      expect.unreachable();
    } catch (e) {
      expect((e as AddonManifestError).code).toBe("addon_manifest_invalid");
    }
  });
});

describe("defineAddon templateSlots (08-07, CONTEXT A1-Q4)", () => {
  const ownSection = { type: "sample-block" };
  const ok = {
    slot: "proof",
    section_type: "sample-block",
    content: () => ({}),
  };

  it("accepts a contribution using the add-on's own section type", () => {
    const m = manifest({ sections: [ownSection], templateSlots: [ok] });
    expect(defineAddon(m)).toBe(m);
  });

  it("accepts a contribution with a page key", () => {
    const m = manifest({
      sections: [ownSection],
      templateSlots: [{ ...ok, slot: "about", page: "about" }],
    });
    expect(defineAddon(m)).toBe(m);
  });

  it("a manifest without templateSlots behaves as before", () => {
    const m = manifest({ sections: [ownSection] });
    expect(defineAddon(m)).toBe(m);
  });

  const bad: [string, unknown][] = [
    ["not an array", {}],
    ["foreign section_type", [{ ...ok, section_type: "hero" }]],
    ["empty slot", [{ ...ok, slot: "" }]],
    ["uppercase slot", [{ ...ok, slot: "Proof" }]],
    ["bad page key", [{ ...ok, page: "About Page" }]],
    ["content not a function", [{ ...ok, content: "x" }]],
    ["entry not an object", ["proof"]],
  ];

  for (const [name, templateSlots] of bad) {
    it(`throws naming templateSlots: ${name}`, () => {
      expect(() =>
        defineAddon(manifest({ sections: [ownSection], templateSlots })),
      ).toThrow(/sample-addon.*templateSlots/);
    });
  }
});

describe("defineAddon privacyClauses (09-11, CONTEXT A5-Q1)", () => {
  const clause = {
    id: "sample-data",
    heading: "Sample sign-ups",
    what: "Names and email addresses visitors type into the sample form.",
    why: "To reply to them.",
    howLong: "Until the business deletes them.",
  };

  it("accepts two valid clauses", () => {
    const m = manifest({
      privacyClauses: [clause, { ...clause, id: "sample-two" }],
    });
    expect(defineAddon(m)).toBe(m);
  });

  it("accepts a manifest without privacyClauses", () => {
    const m = manifest();
    expect(defineAddon(m)).toBe(m);
  });

  const bad: [string, unknown, RegExp][] = [
    ["not an array", {}, /privacyClauses must be an array/],
    ["entry not an object", ["x"], /privacyClauses\[0\] must be an object/],
    ["bad id", [{ ...clause, id: "Bad Id" }], /privacyClauses\[0\]\.id/],
    [
      "duplicate ids",
      [clause, { ...clause }],
      /privacyClauses\[1\]\.id is a duplicate/,
    ],
    [
      "long heading",
      [{ ...clause, heading: "x".repeat(81) }],
      /privacyClauses\[0\]\.heading/,
    ],
    [
      "html in what",
      [{ ...clause, what: "Names <b>bold</b>" }],
      /privacyClauses\[0\]\.what/,
    ],
    [
      "template var in what",
      [{ ...clause, what: "Names {{x}}" }],
      /privacyClauses\[0\]\.what/,
    ],
    [
      "missing howLong",
      [{ ...clause, howLong: undefined }],
      /privacyClauses\[0\]\.howLong/,
    ],
    [
      "a core clause id (WR-B06)",
      [{ ...clause, id: "cookies" }],
      /privacyClauses\[0\]\.id "cookies" is a core privacy clause id/,
    ],
  ];

  for (const [name, privacyClauses, re] of bad) {
    it(`throws naming the field: ${name}`, () => {
      expect(() => defineAddon(manifest({ privacyClauses }))).toThrow(
        AddonManifestError,
      );
      expect(() => defineAddon(manifest({ privacyClauses }))).toThrow(re);
    });
  }
});

describe("manifest today, alerts and the Marketing tab (11-08)", () => {
  const opts = { fileExists: () => true };
  const compose = (ms: readonly AddonManifest[]) =>
    composeAddonRegistry(ms, opts);
  const ping = todayFixture.alerts![0]!;
  const refuses = (ms: readonly AddonManifest[], re: RegExp) => {
    expect(() => compose(ms)).toThrow(AddonManifestError);
    expect(() => compose(ms)).toThrow(re);
  };

  it("composes the fixture with a card, needsYou, an alert and a Marketing tab", () => {
    const reg = compose([todayFixture]);
    const m = reg.get("today-fixture")!;
    expect(m.today?.card?.id).toBe("today-fixture");
    expect(m.today?.needsYou).toBe(true);
    expect(m.alerts?.map((a) => a.type)).toEqual(["today-fixture.ping"]);
    expect(m.nav).toMatchObject({ placement: "tab", item: "marketing" });
  });

  it('NAV_TARGETS includes "marketing" (DASH-26)', () => {
    expect(NAV_TARGETS).toEqual(["website", "marketing"]);
  });

  it('refuses a tab under "reports"', () => {
    refuses(
      [
        fixtureManifest({
          slug: "fixture-a",
          nav: {
            placement: "tab",
            item: "reports",
            label: "X",
            icon: "Globe",
          } as unknown as AddonNav,
        }),
      ],
      /fixture-a.*nav\.item "reports"/,
    );
  });

  it("refuses a card with an empty id or title", () => {
    refuses(
      [{ ...todayFixture, today: { card: { id: "", title: "x" } } }],
      /today-fixture.*today\.card/,
    );
    refuses(
      [{ ...todayFixture, today: { card: { id: "x", title: " " } } }],
      /today-fixture.*today\.card/,
    );
  });

  it("refuses a card that reuses a core card id", () => {
    refuses(
      [{ ...todayFixture, today: { card: { id: "inquiries", title: "x" } } }],
      /today-fixture.*core card id/,
    );
  });

  it("refuses needsYou other than true", () => {
    refuses(
      [
        {
          ...todayFixture,
          today: { needsYou: false as unknown as true },
        },
      ],
      /today-fixture.*today\.needsYou/,
    );
  });

  it("refuses an alert type not prefixed by the slug (T-11-08-02)", () => {
    refuses(
      [{ ...todayFixture, alerts: [{ ...ping, type: "other.ping" }] }],
      /today-fixture.*alert type "other\.ping" must be prefixed "today-fixture\."/,
    );
  });

  it("refuses an alert whose feature is not addon:<slug> (T-11-08-02)", () => {
    refuses(
      [{ ...todayFixture, alerts: [{ ...ping, feature: "billing" }] }],
      /today-fixture.*feature must be "addon:today-fixture"/,
    );
  });

  it("refuses an alert with an unknown level, access or section", () => {
    refuses(
      [
        {
          ...todayFixture,
          alerts: [{ ...ping, level: "loud" as unknown as "normal" }],
        },
      ],
      /today-fixture.*level/,
    );
    refuses(
      [{ ...todayFixture, alerts: [{ ...ping, access: "run" }] }],
      /today-fixture.*access/,
    );
    refuses(
      [{ ...todayFixture, alerts: [{ ...ping, section: "addon:other" }] }],
      /today-fixture.*section/,
    );
  });

  it("refuses a duplicated alert type", () => {
    refuses(
      [{ ...todayFixture, alerts: [ping, { ...ping }] }],
      /today-fixture.*alert type "today-fixture\.ping" is duplicated/,
    );
  });

  it("refuses two manifests declaring the same alert type (composeAlertTypes)", () => {
    // The prefix rule keeps add-ons apart, so the live collision is with a core type: an
    // add-on slugged "form" posing as the core form.message alert (T-11-08-02).
    const poser = fixtureManifest({
      slug: "form",
      alerts: [
        {
          ...ping,
          type: "form.message",
          feature: "addon:form",
          section: "inbox",
        },
      ],
    });
    refuses(
      [todayFixture, poser],
      /"form".*alert type "form\.message" is already defined by core/,
    );
  });

  it("composes two add-ons with distinct alert types", () => {
    const other = fixtureManifest({
      slug: "fixture-c",
      alerts: [
        {
          ...ping,
          type: "fixture-c.ping",
          feature: "addon:fixture-c",
          section: "addon:fixture-c",
        },
      ],
    });
    expect(() => compose([todayFixture, other])).not.toThrow();
  });

  it("an existing manifest without today or alerts composes as before", () => {
    expect(() =>
      compose([fixtureManifest({ slug: "fixture-b" })]),
    ).not.toThrow();
  });
});

describe("core entitlement keys are reserved (review WR-B03)", () => {
  it("every CORE_ENTITLEMENTS key is a reserved add-on slug", () => {
    for (const key of CORE_ENTITLEMENTS) {
      expect(RESERVED_ADDON_SLUGS as readonly string[]).toContain(key);
    }
  });
});
