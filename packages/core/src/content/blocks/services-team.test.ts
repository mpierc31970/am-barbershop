// Services and Our team blocks (08-04; CONTEXT A3-Q3, D253, D37, D257: options only).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  SERVICES_HEADING_MAX,
  defaultServicesBlock,
  servicesSection,
  validateServicesBlock,
} from "./services";
import { defaultTeamBlock, teamSection, validateTeamBlock } from "./team";

const EMPTY_REFS = { popups: [], forms: [], media: [] };

describe("services content", () => {
  it("defaults", () => {
    const d = defaultServicesBlock();
    expect(d).toEqual({
      heading: "Services",
      display: "cards",
      limit: 0,
      show_descriptions: true,
      show_durations: true,
    });
    expect(validateServicesBlock({})).toEqual(d);
  });

  it("clamps enums and switches, drops unknown keys", () => {
    expect(validateServicesBlock({ display: "grid" }).display).toBe("cards");
    expect(validateServicesBlock({ display: "list" }).display).toBe("list");
    expect(validateServicesBlock({ limit: 7 }).limit).toBe(0);
    expect(validateServicesBlock({ limit: "6" }).limit).toBe(0);
    expect(validateServicesBlock({ limit: 6 }).limit).toBe(6);
    expect(validateServicesBlock({ limit: 12 }).limit).toBe(12);
    const v = validateServicesBlock({
      show_descriptions: "no",
      show_durations: 0,
      items: [{ name: "Copied" }],
    });
    expect(v.show_descriptions).toBe(true);
    expect(v.show_durations).toBe(true);
    expect(v).not.toHaveProperty("items");
    expect(
      validateServicesBlock({ show_descriptions: false }).show_descriptions,
    ).toBe(false);
  });

  it("trims and caps the heading", () => {
    expect(validateServicesBlock({ heading: "  Menu  " }).heading).toBe("Menu");
    expect(validateServicesBlock({ heading: "" }).heading).toBe("");
    expect(
      validateServicesBlock({ heading: "x".repeat(SERVICES_HEADING_MAX) })
        .heading,
    ).toHaveLength(SERVICES_HEADING_MAX);
    expect(() =>
      validateServicesBlock({ heading: "x".repeat(SERVICES_HEADING_MAX + 1) }),
    ).toThrow(InvalidInput);
    expect(() => validateServicesBlock("x")).toThrow(InvalidInput);
  });

  it("contract", () => {
    const d = defaultServicesBlock();
    expect(servicesSection.validate(d, "full")).toEqual(d);
    expect(servicesSection.type).toBe("services");
    expect(servicesSection.label).toBe("Services");
    expect(servicesSection.description).toBe(
      "Your services and prices, always up to date",
    );
    expect(servicesSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(servicesSection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(servicesSection.refsOf(d)).toEqual(EMPTY_REFS);
    expect(servicesSection.textsOf(d)).toEqual(["Services"]);
    expect(servicesSection.textsOf({ ...d, heading: "" })).toEqual([]);
    expect(servicesSection.urlsOf(d)).toEqual([]);
    for (const bad of [null, undefined, 5, "x", []]) {
      expect(() => servicesSection.textsOf(bad)).not.toThrow();
      expect(() => servicesSection.mapRichText(bad, (h) => h)).not.toThrow();
    }
  });
});

describe("team content", () => {
  it("defaults and switches", () => {
    const d = defaultTeamBlock();
    expect(d).toEqual({
      heading: "Our team",
      show_roles: true,
      show_bios: true,
    });
    expect(validateTeamBlock({})).toEqual(d);
    expect(validateTeamBlock({ show_roles: false })).toEqual({
      heading: "Our team",
      show_roles: false,
      show_bios: true,
    });
    expect(validateTeamBlock({ show_bios: "yes" }).show_bios).toBe(true);
    expect(
      validateTeamBlock({ heading: " Staff ", members: [{ name: "A" }] }),
    ).toEqual({ heading: "Staff", show_roles: true, show_bios: true });
    expect(() => validateTeamBlock("x")).toThrow(InvalidInput);
  });

  it("contract", () => {
    const d = defaultTeamBlock();
    expect(teamSection.validate(d, "full")).toEqual(d);
    expect(teamSection.type).toBe("team");
    expect(teamSection.label).toBe("Our team");
    expect(teamSection.description).toBe(
      "The people customers will meet, from your team list",
    );
    expect(teamSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(teamSection.headings).toEqual({ ownsH1: false, blockHeading: "h2" });
    expect(teamSection.refsOf(d)).toEqual(EMPTY_REFS);
    expect(teamSection.textsOf(d)).toEqual(["Our team"]);
    expect(teamSection.urlsOf(d)).toEqual([]);
    for (const bad of [null, undefined, 5, "x", []]) {
      expect(() => teamSection.textsOf(bad)).not.toThrow();
      expect(() => teamSection.mapRichText(bad, (h) => h)).not.toThrow();
    }
  });
});
