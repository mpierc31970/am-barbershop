// FONT_PAIRINGS data checks (CONTEXT A4-Q4, UI-SPEC "Font pairing cards"): the owner labels
// match the UI-SPEC table and every face resolves in the P4 FONT_CATALOG for its role.
import { describe, expect, it } from "vitest";
import { findFont } from "./fonts";
import { FONT_PAIRINGS, findPairing } from "./pairings";

const EXPECTED: [string, string][] = [
  ["cds-choose", "Let Support choose"],
  ["warm-classic", "Warm and classic"],
  ["calm-bookish", "Calm and bookish"],
  ["bold-clear", "Bold and clear"],
  ["friendly-relaxed", "Friendly and relaxed"],
  ["clean-modern", "Clean and modern"],
  ["trustworthy-practical", "Trustworthy and practical"],
];

describe("FONT_PAIRINGS (CONTEXT A4-Q4)", () => {
  it("lists the seven UI-SPEC pairings in order", () => {
    expect(FONT_PAIRINGS.map((p) => [p.id, p.label])).toEqual(EXPECTED);
  });

  it("Let Support choose comes first with null faces and its helper", () => {
    const first = FONT_PAIRINGS[0]!;
    expect(first.heading).toBeNull();
    expect(first.body).toBeNull();
    expect(first.helper).toBe("We'll pick fonts that fit your mood board.");
  });

  it("every named face is in the catalog and allowed in its role", () => {
    for (const p of FONT_PAIRINGS.slice(1)) {
      const heading = findFont(p.heading ?? "");
      const body = findFont(p.body ?? "");
      expect(heading, p.id).not.toBeNull();
      expect(body, p.id).not.toBeNull();
      expect(heading!.roles).toContain("heading");
      expect(body!.roles).toContain("body");
    }
  });

  it("ids are unique", () => {
    const ids = FONT_PAIRINGS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("findPairing returns the match, and Let Support choose for anything unknown", () => {
    expect(findPairing("bold-clear").heading).toBe("Archivo");
    expect(findPairing("nope").id).toBe("cds-choose");
    expect(findPairing(undefined).id).toBe("cds-choose");
    expect(findPairing(42).id).toBe("cds-choose");
  });
});
