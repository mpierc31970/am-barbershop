// THEME-01 / THEME-02 (safety half): the deny-by-default organization.design validator,
// the public projection and the neutral preset (T-04-11..T-04-14).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { contrastRatio } from "./contrast";
import { NEUTRAL_DESIGN, NEUTRAL_HASH } from "./neutral";
import { ROLES } from "./roles";
import { solveContrast } from "./solver";
import type { OrganizationDesign, RoleMap } from "./types";
import {
  SOURCE_MAX_BYTES,
  projectPublicDesign,
  validateOrganizationDesign,
} from "./validate";

type Loose = Record<string, unknown>;

function clone(d: OrganizationDesign): Loose {
  return JSON.parse(JSON.stringify(d)) as Loose;
}

function withPatch(patch: (d: Loose) => void): Loose {
  const d = clone(NEUTRAL_DESIGN);
  patch(d);
  return d;
}

function rejects(raw: unknown, match?: string | RegExp): void {
  expect(() => validateOrganizationDesign(raw)).toThrow(InvalidInput);
  if (match !== undefined)
    expect(() => validateOrganizationDesign(raw)).toThrow(match);
}

const ALMANAC_ROLES: RoleMap = {
  surface: "#f7f1e8",
  "surface-raised": "#ede3d3",
  text: "#2a211b",
  "text-muted": "#6a5a4c",
  primary: "#9a3b22",
  "primary-contrast": "#fff8f0",
  accent: "#56642a",
  border: "#d8cab4",
};

const TIDEWATER_AUTHORED: RoleMap = {
  surface: "#f3f6f8",
  "surface-raised": "#e1eaef",
  text: "#0f1d26",
  "text-muted": "#465a66",
  primary: "#1f3fcc",
  "primary-contrast": "#ffffff",
  accent: "#f06a4d",
  border: "#c3d1d9",
};

function themed(
  name: string,
  roles: RoleMap,
  typography: Loose,
  rounded: Loose,
  overlay: string,
): Loose {
  return withPatch((d) => {
    d.name = name;
    d.roles = roles;
    d.typography = typography;
    d.rounded = rounded;
    d.shadows = { overlay };
    d.sourceHash = "3f9a1c2e".repeat(8);
  });
}

describe("NEUTRAL_DESIGN", () => {
  it("restates the P3 look (UI-SPEC Theme 0)", () => {
    expect(NEUTRAL_HASH).toBe("00000000");
    expect(NEUTRAL_DESIGN.schemaVersion).toBe(2);
    expect(NEUTRAL_DESIGN.name).toBe("Neutral");
    expect(NEUTRAL_DESIGN.roles).toEqual({
      surface: "#fbfaf8",
      "surface-raised": "#f1efea",
      text: "#1d1c1a",
      "text-muted": "#5e5a54",
      primary: "#1d1c1a",
      "primary-contrast": "#ffffff",
      accent: "#8a4b2a",
      border: "#d8d4cc",
    });
    expect(NEUTRAL_DESIGN.typography).toEqual({
      headingFamily: "System Sans",
      bodyFamily: "System Sans",
      body: "18px",
      h3: "24px",
      h2: "36px",
      display: "clamp(2.5rem, 4vw + 1rem, 3.5rem)",
    });
    expect(NEUTRAL_DESIGN.rounded).toEqual({ button: "4px", media: "4px" });
    expect(NEUTRAL_DESIGN.shadows).toEqual({
      overlay: "0 16px 48px rgb(0 0 0 / 0.18)",
    });
    expect(NEUTRAL_DESIGN.contrast.adjustments).toEqual([]);
    expect(NEUTRAL_DESIGN.contrast.pairs.every((p) => p.pass)).toBe(true);
    expect(NEUTRAL_DESIGN.sourceHash).toBe("0".repeat(64));
  });
});

describe("validateOrganizationDesign: accepts", () => {
  it("returns a deep-equal fresh copy of the neutral preset", () => {
    const out = validateOrganizationDesign(NEUTRAL_DESIGN);
    expect(out).toEqual(NEUTRAL_DESIGN);
    expect(out).not.toBe(NEUTRAL_DESIGN);
    expect(out.roles).not.toBe(NEUTRAL_DESIGN.roles);
    expect(out.source).not.toBe(NEUTRAL_DESIGN.source);
  });

  it("accepts an Almanac-shaped design", () => {
    const d = themed(
      "Almanac",
      ALMANAC_ROLES,
      {
        headingFamily: "Fraunces",
        bodyFamily: "Source Serif 4",
        body: "18px",
        h3: "24px",
        h2: "40px",
        display: "clamp(2.75rem, 5vw + 1rem, 4.5rem)",
      },
      { button: "2px", media: "2px" },
      "0 18px 48px rgb(42 33 27 / 0.20)",
    );
    const out = validateOrganizationDesign(d);
    expect(out.name).toBe("Almanac");
    expect(out.typography.headingFamily).toBe("Fraunces");
  });

  it("accepts a Tidewater-shaped design with the solved accent", () => {
    const solved = solveContrast(TIDEWATER_AUTHORED);
    expect(solved.roles.accent).not.toBe("#f06a4d");
    const d = themed(
      "Tidewater",
      solved.roles,
      {
        headingFamily: "Archivo",
        bodyFamily: "Public Sans",
        body: "18px",
        h3: "22px",
        h2: "36px",
        display: "clamp(2.5rem, 6vw + 0.5rem, 5rem)",
      },
      { button: "999px", media: "12px" },
      "0 20px 56px rgb(15 29 38 / 0.22)",
    );
    (d.contrast as Loose).adjustments = solved.adjustments;
    const out = validateOrganizationDesign(d);
    expect(out.contrast.adjustments).toEqual(solved.adjustments);
    expect(out.rounded.button).toBe("999px");
  });

  it("recomputes contrast pairs from the roles instead of trusting input", () => {
    const d = withPatch((x) => {
      (x.contrast as Loose).pairs = [
        { fg: "text", bg: "surface", ratio: 99, min: 4.5, pass: true },
      ];
    });
    expect(validateOrganizationDesign(d).contrast.pairs).toEqual(
      NEUTRAL_DESIGN.contrast.pairs,
    );
  });
});

describe("validateOrganizationDesign: rejects", () => {
  it("non-object input", () => {
    for (const v of [null, undefined, "x", 1, [], true]) rejects(v);
  });

  it("any schemaVersion other than 2", () => {
    rejects(
      withPatch((d) => (d.schemaVersion = 1)),
      /schemaVersion 2/,
    );
    rejects(withPatch((d) => (d.schemaVersion = "2")));
  });

  it("a missing role", () => {
    rejects(
      withPatch((d) => delete (d.roles as Loose).border),
      "Missing role: border.",
    );
  });

  it("a non-hex or short or uppercase role value", () => {
    for (const v of ["#FFF", "red", "#FFFFFF", "#ffffff;}"]) {
      rejects(
        withPatch((d) => ((d.roles as Loose).surface = v)),
        /roles\.surface/,
      );
    }
  });

  it("a heading family outside the catalog, with the nearest suggestion", () => {
    rejects(
      withPatch(
        (d) => ((d.typography as Loose).headingFamily = "Playfair Display"),
      ),
      /^"Playfair Display" is not in the font catalog\. Nearest: [A-Za-z0-9 ]+\. Pick a catalog family or add one to the catalog \(a deploy\)\.$/,
    );
  });

  it("a display face as the body font", () => {
    rejects(
      withPatch((d) => ((d.typography as Loose).bodyFamily = "Fraunces")),
      "Fraunces is a display face and can't be the body font. Try Source Serif 4 or Newsreader.",
    );
  });

  it("a display size outside the grammar, naming the path", () => {
    rejects(
      withPatch(
        (d) => ((d.typography as Loose).display = "clamp(2rem, 10vw, 9rem)"),
      ),
      /^typography\.display "clamp\(2rem, 10vw, 9rem\)" is outside the allowed range/,
    );
  });

  it("bad radius and bad overlay shadow", () => {
    rejects(
      withPatch((d) => ((d.rounded as Loose).media = "40px")),
      /rounded\.media/,
    );
    rejects(
      withPatch((d) => ((d.shadows as Loose).overlay = "0 16px 0 red")),
      /shadows\.overlay/,
    );
  });

  it("a malformed sourceHash", () => {
    rejects(
      withPatch((d) => (d.sourceHash = "abc")),
      /sourceHash/,
    );
    rejects(
      withPatch((d) => (d.sourceHash = "A".repeat(64))),
      /sourceHash/,
    );
  });

  it("an oversized source", () => {
    const d = withPatch((x) => {
      (x.source as Loose).designMd = {
        frontMatter: {},
        body: "x".repeat(SOURCE_MAX_BYTES),
      };
    });
    expect(JSON.stringify(d.source).length).toBeGreaterThan(SOURCE_MAX_BYTES);
    rejects(d, /256 KB/);
  });

  it("an enforced pair below its minimum", () => {
    const d = withPatch((x) => ((x.roles as Loose).text = "#949494"));
    const ratio = contrastRatio("#949494", "#fbfaf8");
    expect(ratio).toBeLessThan(4.5);
    expect(ratio).toBeGreaterThan(2.5);
    rejects(d, /text on surface/);
  });
});

describe("validateOrganizationDesign: deny by default", () => {
  it("drops extra top-level and nested keys", () => {
    const d = withPatch((x) => {
      x.evil = "<script>";
      (x.roles as Loose).backdrop = "#000000";
      (x.typography as Loose).weight = "900";
    });
    const out = validateOrganizationDesign(d) as unknown as Loose;
    expect(out).not.toHaveProperty("evil");
    expect(Object.keys(out.roles as Loose).sort()).toEqual([...ROLES].sort());
    expect(out.typography).not.toHaveProperty("weight");
  });

  it("never lets __proto__ reach a prototype", () => {
    const d = withPatch((x) => {
      x.spacing = JSON.parse(
        '{"__proto__": {"polluted": "yes"}, "md": "16px"}',
      );
      x.motion = JSON.parse('{"__proto__": {"polluted": "yes"}}');
    });
    const out = validateOrganizationDesign(d);
    expect(({} as Loose).polluted).toBeUndefined();
    expect((out.spacing as Loose).polluted).toBeUndefined();
    expect(out.spacing.md).toBe("16px");
    expect(Object.getPrototypeOf(out.spacing)).toBe(Object.prototype);
  });

  it("refuses non-primitive spacing and motion values", () => {
    rejects(withPatch((d) => (d.spacing = { md: { nested: true } })));
    rejects(withPatch((d) => (d.motion = { ease: ["a"] })));
  });
});

describe("projectPublicDesign", () => {
  it("picks exactly the seven render keys", () => {
    const pub = projectPublicDesign(NEUTRAL_DESIGN);
    expect(Object.keys(pub ?? {}).sort()).toEqual(
      [
        "name",
        "roles",
        "rounded",
        "schemaVersion",
        "shadows",
        "sourceHash",
        "typography",
      ].sort(),
    );
    expect(pub?.roles).toEqual(NEUTRAL_DESIGN.roles);
  });

  it("returns null for non-objects", () => {
    expect(projectPublicDesign(null)).toBeNull();
    expect(projectPublicDesign("x")).toBeNull();
    expect(projectPublicDesign([])).toBeNull();
  });

  it("never carries source or component HTML/CSS", () => {
    const raw = clone(NEUTRAL_DESIGN);
    (raw.source as Loose).sidecar = { components: "<style>x</style>" };
    (raw.roles as Loose).extra = "#000000";
    const pub = projectPublicDesign(raw) as unknown as Loose;
    expect(pub).not.toHaveProperty("source");
    expect(JSON.stringify(pub)).not.toContain("<style>");
    expect(pub.roles).not.toHaveProperty("extra");
  });
});
