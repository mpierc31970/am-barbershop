// ONB-11, D176, D177, D268: path rules proven with fixture add-ons.
import { describe, expect, it } from "vitest";
import { pathFixtureRegistry } from "./__fixtures__/path-addons";
import {
  PATH_RULES,
  pickSourceFrom,
  pickableAddons,
  reconcileSelections,
  toPickableAddon,
} from "./index";
import type { BusinessType, PickSource } from "./index";
import type { QuoteSelections } from "../pricing";

const registry = pathFixtureRegistry();
const slugs = (list: readonly { slug: string }[]) => list.map((a) => a.slug);

// A studio type that (wrongly) recommends events, and a type naming an unknown slug.
const TYPES: readonly BusinessType[] = [
  {
    id: "test-salon",
    label: "Test salon",
    copyGroup: "studio",
    plural: "test salons",
    paths: ["studio"],
    recommended: ["fixture-events", "fixture-studio-booking"],
    aup: "ok",
    aboutSeed: "{name} is a salon in {city}.",
  },
  {
    id: "test-bakery",
    label: "Test bakery",
    copyGroup: "shop",
    plural: "test bakeries",
    paths: ["standard"],
    recommended: ["not-a-real-addon", "fixture-quote", "fixture-appointments"],
    aup: "ok",
    aboutSeed: "{name} is a bakery in {city}.",
  },
];

describe("pickableAddons", () => {
  it("never offers Appointments on Studio", () => {
    const { recommended, rest } = pickableAddons(
      registry,
      "studio",
      null,
      TYPES,
    );
    expect([...slugs(recommended), ...slugs(rest)]).not.toContain(
      "fixture-appointments",
    );
  });

  it("never offers Studio Booking on Standard", () => {
    const { recommended, rest } = pickableAddons(
      registry,
      "standard",
      null,
      TYPES,
    );
    expect([...slugs(recommended), ...slugs(rest)]).not.toContain(
      "fixture-studio-booking",
    );
  });

  it("puts events only under See all on Studio, even when recommended (D268)", () => {
    expect(PATH_RULES.studio?.seeAllOnly).toContain("events");
    const rules = { studio: { seeAllOnly: ["fixture-events"] } } as const;
    const { recommended, rest } = pickableAddons(
      registry,
      "studio",
      "test-salon",
      TYPES,
      rules,
    );
    expect(slugs(recommended)).toEqual(["fixture-studio-booking"]);
    expect(slugs(rest)).toContain("fixture-events");
  });

  it("never lists a private add-on", () => {
    for (const path of ["standard", "studio"] as const) {
      const { recommended, rest } = pickableAddons(registry, path, null, TYPES);
      expect([...slugs(recommended), ...slugs(rest)]).not.toContain(
        "fixture-private",
      );
    }
  });

  it("filters private add-ons even if a source leaks one (defence in depth)", () => {
    const leaky: PickSource = {
      publicList: () => registry.list().map(toPickableAddon),
    };
    const { rest } = pickableAddons(leaky, "standard", null, TYPES);
    expect(slugs(rest)).not.toContain("fixture-private");
  });

  it("skips unknown recommended slugs and keeps the type's order", () => {
    const { recommended, rest } = pickableAddons(
      registry,
      "standard",
      "test-bakery",
      TYPES,
    );
    expect(slugs(recommended)).toEqual([
      "fixture-quote",
      "fixture-appointments",
    ]);
    expect(slugs(rest)).toEqual(["fixture-events"]);
  });

  it("rest keeps manifest order", () => {
    const { rest } = pickableAddons(registry, "standard", null, TYPES);
    expect(slugs(rest)).toEqual([
      "fixture-appointments",
      "fixture-events",
      "fixture-quote",
    ]);
  });

  it.each([null, "other", "no-such-type"])(
    "type %s recommends nothing and lists everything under rest",
    (id) => {
      const { recommended, rest } = pickableAddons(
        registry,
        "studio",
        id,
        TYPES,
      );
      expect(recommended).toEqual([]);
      expect(slugs(rest)).toEqual(["fixture-studio-booking", "fixture-events"]);
    },
  );

  it("a type from another path recommends nothing", () => {
    const { recommended } = pickableAddons(
      registry,
      "studio",
      "test-bakery",
      TYPES,
    );
    expect(recommended).toEqual([]);
  });

  it("works on a plain serialisable list (browser side)", () => {
    const plain = pickSourceFrom(registry.publicList().map(toPickableAddon));
    const { rest } = pickableAddons(plain, "standard", null, TYPES);
    expect(slugs(rest)).toEqual([
      "fixture-appointments",
      "fixture-events",
      "fixture-quote",
    ]);
    expect(JSON.parse(JSON.stringify(rest))).toEqual(rest);
  });
});

describe("reconcileSelections", () => {
  const quote: QuoteSelections = {
    addons: ["fixture-appointments", "fixture-events"],
    extras: ["logo-design"],
    carePlan: true,
    cadence: "yearly",
  };

  it("drops add-ons that do not fit the new path and reports them", () => {
    const { selections, removed } = reconcileSelections(
      registry,
      "studio",
      quote,
    );
    expect(removed).toEqual(["fixture-appointments"]);
    expect(selections).toEqual({ ...quote, addons: ["fixture-events"] });
  });

  it("keeps everything when all add-ons fit", () => {
    const { selections, removed } = reconcileSelections(
      registry,
      "standard",
      quote,
    );
    expect(removed).toEqual([]);
    expect(selections).toEqual(quote);
  });
});
