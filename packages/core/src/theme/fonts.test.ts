// The curated font catalog (CONTEXT A2-Q4, D-UI-P4-5; UI-SPEC "Font catalog").
import { describe, expect, it } from "vitest";
import {
  FONT_CATALOG,
  SANS_FALLBACK,
  SERIF_FALLBACK,
  bodySuggestions,
  findFont,
  fontStack,
  nearestFont,
} from "./fonts";

describe("FONT_CATALOG", () => {
  it("holds the 12 UI-SPEC families in order", () => {
    expect(FONT_CATALOG.map((f) => f.name)).toEqual([
      "Fraunces",
      "Newsreader",
      "Source Serif 4",
      "Literata",
      "Bricolage Grotesque",
      "Archivo",
      "Public Sans",
      "Figtree",
      "Work Sans",
      "Instrument Sans",
      "System Sans",
      "System Serif",
    ]);
  });

  it("marks Fraunces and Bricolage Grotesque as heading-only display faces", () => {
    for (const name of ["Fraunces", "Bricolage Grotesque"]) {
      const f = findFont(name);
      expect(f?.display).toBe(true);
      expect(f?.roles).toEqual(["heading"]);
      expect(f?.italic).toBe(false);
    }
    const others = FONT_CATALOG.filter(
      (f) => f.name !== "Fraunces" && f.name !== "Bricolage Grotesque",
    );
    for (const f of others) {
      expect(f.display).toBe(false);
      expect(f.roles).toEqual(["heading", "body"]);
    }
  });

  it("system stacks download nothing", () => {
    for (const name of ["System Sans", "System Serif"]) {
      const f = findFont(name);
      expect(f?.cssFamily).toBeNull();
      expect(f?.pkg).toBeNull();
    }
  });

  it("every package is a fontsource variable build and every family a Variable face", () => {
    const hosted = FONT_CATALOG.filter((f) => f.pkg !== null);
    expect(hosted).toHaveLength(10);
    for (const f of hosted) {
      expect(f.pkg?.startsWith("@fontsource-variable/")).toBe(true);
      expect(f.cssFamily?.endsWith(" Variable")).toBe(true);
      expect(f.cssFamily).toMatch(/^[A-Za-z0-9 ]+$/);
    }
  });
});

describe("findFont", () => {
  it("is case-insensitive and exact", () => {
    expect(findFont("source serif 4")?.name).toBe("Source Serif 4");
    expect(findFont("Source Serif")).toBeNull();
    expect(findFont("Playfair Display")).toBeNull();
    expect(findFont("")).toBeNull();
  });
});

describe("fontStack", () => {
  it("appends the same-class fallback", () => {
    expect(fontStack("Source Serif 4")).toBe(
      '"Source Serif 4 Variable", ' + SERIF_FALLBACK,
    );
    expect(fontStack("Archivo")).toBe('"Archivo Variable", ' + SANS_FALLBACK);
    expect(fontStack("Archivo")?.endsWith(SANS_FALLBACK)).toBe(true);
  });

  it("returns the bare system stack for System Sans / System Serif", () => {
    expect(fontStack("System Sans")).toBe(SANS_FALLBACK);
    expect(fontStack("System Serif")).toBe(SERIF_FALLBACK);
  });

  it("is null for a family outside the catalog", () => {
    expect(fontStack("Playfair Display")).toBeNull();
    expect(fontStack('Archivo"; } body { color: red')).toBeNull();
  });

  it("uses the P3 system sans stack", () => {
    expect(SANS_FALLBACK).toBe(
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    );
    expect(SERIF_FALLBACK).toBe('ui-serif, Georgia, "Times New Roman", serif');
  });
});

describe("nearestFont", () => {
  it("always returns a catalog family", () => {
    const f = nearestFont("Playfair Display", "heading");
    expect(FONT_CATALOG).toContain(f);
  });

  it("never suggests a display face for the body role", () => {
    for (const probe of ["Fraunces", "Bricolage Grotesque", "Frances", "x"]) {
      expect(nearestFont(probe, "body").display).toBe(false);
    }
  });

  it("finds close misspellings", () => {
    expect(nearestFont("Figtre", "body").name).toBe("Figtree");
    expect(nearestFont("literata", "heading").name).toBe("Literata");
  });
});

describe("bodySuggestions", () => {
  it("suggests two same-class body faces for a display face", () => {
    expect(bodySuggestions("Fraunces")).toEqual([
      "Source Serif 4",
      "Newsreader",
    ]);
    const sans = bodySuggestions("Bricolage Grotesque");
    expect(sans).toHaveLength(2);
    for (const name of sans) expect(findFont(name)?.class).toBe("sans");
  });
});
