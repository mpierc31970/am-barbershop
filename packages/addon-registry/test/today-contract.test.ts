// Add-on Today contract (DASH-21, DASH-35; invariant 4; 11-08). A manifest that declares a
// Today card or Needs-you items must back it with the matching `today` export of its server
// entry, and the platform reaches those exports only through the registry (SERVER_MODULES),
// only for active, unpaused add-ons.
import { describe, expect, it } from "vitest";
import { composeAddonRegistry } from "@cds/core/addons";
import { todayFixture } from "../../core/src/addons/__fixtures__/manifests";
import { ADDON_REGISTRY, ADDON_SERVER } from "../src/server";
import {
  activeTodayProviders,
  assertTodayExports,
  type TodayServerModules,
} from "../src/today";
import type { AddonServerToday, OrgContextLike } from "../src/types";

const registry = composeAddonRegistry([todayFixture], {
  fileExists: () => true,
});

const ctx = { orgId: "org1" } as unknown as OrgContextLike;

const fakeToday: AddonServerToday = {
  card: async () => ({
    title: "Fixture card",
    rows: [{ label: "Pings", value: "3" }],
    link: { label: "Open", href: "/hub/addons/today-fixture" },
  }),
  needsYou: async () => [
    {
      key: "today-fixture:ping",
      kind: "today-fixture.ping",
      level: "normal",
      title: "A fixture needs you",
      actionLabel: "Open",
      href: "/hub/addons/today-fixture",
      section: "addon:today-fixture",
      at: "2026-10-11T12:00:00.000Z",
    },
  ],
};

const servers: TodayServerModules = { "today-fixture": { today: fakeToday } };

describe("activeTodayProviders (DASH-21)", () => {
  it("returns the fixture's card and needsYou when its slug is active", async () => {
    const out = activeTodayProviders(registry, servers, ["today-fixture"]);
    expect(out.map((p) => p.slug)).toEqual(["today-fixture"]);
    const [p] = out;
    expect(p!.cardSpec).toEqual({ id: "today-fixture", title: "Fixture card" });
    expect((await p!.card!(ctx))?.title).toBe("Fixture card");
    expect((await p!.needsYou!(ctx))[0]?.key).toBe("today-fixture:ping");
  });

  it("returns nothing when the add-on is not active", () => {
    expect(activeTodayProviders(registry, servers, [])).toEqual([]);
    expect(activeTodayProviders(registry, servers, ["testimonials"])).toEqual(
      [],
    );
  });

  it("returns nothing when the add-on is paused by a billing lapse", () => {
    expect(
      activeTodayProviders(
        registry,
        servers,
        ["today-fixture"],
        ["today-fixture"],
      ),
    ).toEqual([]);
  });

  it("skips a provider the manifest does not declare", () => {
    const cardOnly = composeAddonRegistry(
      [{ ...todayFixture, today: { card: todayFixture.today!.card! } }],
      { fileExists: () => true },
    );
    const [p] = activeTodayProviders(cardOnly, servers, ["today-fixture"]);
    expect(p!.card).toBeTypeOf("function");
    expect(p!.needsYou).toBeUndefined();
  });

  it("ignores unknown slugs and slugs without a server module", () => {
    expect(activeTodayProviders(registry, {}, ["today-fixture"])).toEqual([]);
    expect(
      activeTodayProviders(registry, servers, ["__proto__", "nope"]),
    ).toEqual([]);
  });
});

describe("assertTodayExports (DASH-21)", () => {
  it("passes the fixture with a full server today export", () => {
    expect(() =>
      assertTodayExports(todayFixture, { today: fakeToday }),
    ).not.toThrow();
  });

  it("fails a manifest declaring today.card whose server lacks today.card", () => {
    expect(() =>
      assertTodayExports(todayFixture, {
        today: { needsYou: fakeToday.needsYou },
      }),
    ).toThrow(/today-fixture.*today\.card/);
    expect(() => assertTodayExports(todayFixture, {})).toThrow(
      /today-fixture.*today\.card/,
    );
  });

  it("fails a manifest declaring needsYou whose server lacks today.needsYou", () => {
    expect(() =>
      assertTodayExports(todayFixture, { today: { card: fakeToday.card } }),
    ).toThrow(/today-fixture.*today\.needsYou/);
  });

  it("fails a server today export the manifest does not declare", () => {
    const bare = { ...todayFixture, today: undefined };
    expect(() => assertTodayExports(bare, { today: fakeToday })).toThrow(
      /today-fixture.*not declared/,
    );
  });

  it("every real add-on passes (they declare no card)", () => {
    const real = ADDON_REGISTRY.list();
    expect(real.length).toBeGreaterThan(0);
    for (const m of real) {
      expect(() => assertTodayExports(m, ADDON_SERVER[m.slug])).not.toThrow();
    }
  });
});
