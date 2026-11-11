// THEME-03: colour -> role mapping, explicit (extensions.roles) or derived from colorMeta
// (CONTEXT A2-Q2, RESEARCH Pitfall 7).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { mapRoles } from "./map";

const COLORS: Record<string, string> = {
  paper: "#FAF4EA",
  linen: "#F1E7D8",
  rule: "#D9C7AE",
  "ink-soft": "#3D5551",
  ink: "#12312F",
  teal: "#17656A",
  bronze: "#8A5424",
  rose: "#9A5F5A",
  white: "#FFFFFF",
};

const EXPLICIT = {
  surface: "paper",
  "surface-raised": "linen",
  text: "ink",
  "text-muted": "ink-soft",
  primary: "teal",
  "primary-contrast": "white",
  accent: "bronze",
  border: "rule",
};

const META = {
  paper: { role: "neutral" },
  linen: { role: "neutral" },
  rule: { role: "neutral" },
  "ink-soft": { role: "neutral" },
  ink: { role: "neutral" },
  teal: { role: "primary" },
  rose: { role: "secondary" },
  bronze: { role: "accent" },
};

describe("mapRoles (explicit)", () => {
  it("uses extensions.roles and normalizes to lowercase #rrggbb", () => {
    const { roles, derived } = mapRoles(COLORS, {
      extensions: { roles: EXPLICIT },
    });
    expect(derived).toBeNull();
    expect(roles).toEqual({
      surface: "#faf4ea",
      "surface-raised": "#f1e7d8",
      text: "#12312f",
      "text-muted": "#3d5551",
      primary: "#17656a",
      "primary-contrast": "#ffffff",
      accent: "#8a5424",
      border: "#d9c7ae",
    });
  });

  it("accepts oklch() colours", () => {
    const { roles } = mapRoles(
      { ...COLORS, teal: "oklch(0.5 0.1 190)" },
      { extensions: { roles: EXPLICIT } },
    );
    expect(roles.primary).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("fails with the UI-SPEC copy when a named colour does not exist", () => {
    expect(() =>
      mapRoles(COLORS, {
        extensions: { roles: { ...EXPLICIT, "primary-contrast": "cream" } },
      }),
    ).toThrow(
      "Missing role: primary-contrast. Add it to extensions.roles in design.json, then run again.",
    );
  });

  it("fails when extensions.roles leaves a role out", () => {
    const partial: Record<string, string> = { ...EXPLICIT };
    delete partial.border;
    expect(() => mapRoles(COLORS, { extensions: { roles: partial } })).toThrow(
      "Missing role: border.",
    );
  });

  it("rejects a colour value it cannot parse", () => {
    expect(() =>
      mapRoles(
        { ...COLORS, teal: "teal-ish" },
        { extensions: { roles: EXPLICIT } },
      ),
    ).toThrow(InvalidInput);
  });
});

describe("mapRoles (derived from colorMeta)", () => {
  it("derives every role by colorMeta.role and luminance", () => {
    const { roles, derived } = mapRoles(COLORS, {
      extensions: { colorMeta: META },
    });
    expect(derived).toEqual({
      surface: "paper",
      "surface-raised": "linen",
      text: "ink",
      "text-muted": "ink-soft",
      primary: "teal",
      "primary-contrast": "#ffffff",
      accent: "bronze",
      border: "rule",
    });
    expect(roles["primary-contrast"]).toBe("#ffffff");
    expect(roles.surface).toBe("#faf4ea");
    expect(roles.text).toBe("#12312f");
  });

  it("keeps the lightest neutral for primary-contrast when it contrasts at least as much as #ffffff", () => {
    const { derived } = mapRoles(
      { ...COLORS, paper: "#FFFFFF" },
      { extensions: { colorMeta: META } },
    );
    expect(derived?.["primary-contrast"]).toBe("paper");
  });

  it("falls back to tertiary, then secondary, for accent", () => {
    const noAccent = { ...META, bronze: { role: "tertiary" } };
    expect(
      mapRoles(COLORS, { extensions: { colorMeta: noAccent } }).derived?.accent,
    ).toBe("bronze");
    const secondaryOnly: Record<string, { role: string }> = { ...META };
    delete secondaryOnly.bronze;
    expect(
      mapRoles(COLORS, { extensions: { colorMeta: secondaryOnly } }).derived
        ?.accent,
    ).toBe("rose");
  });

  it("fails with the missing-role copy when there is no primary", () => {
    const noPrimary: Record<string, { role: string }> = { ...META };
    delete noPrimary.teal;
    expect(() =>
      mapRoles(COLORS, { extensions: { colorMeta: noPrimary } }),
    ).toThrow("Missing role: primary.");
  });

  it("fails when there are too few neutrals to fill text-muted", () => {
    const three = {
      paper: { role: "neutral" },
      linen: { role: "neutral" },
      ink: { role: "neutral" },
      teal: { role: "primary" },
      bronze: { role: "accent" },
    };
    expect(() =>
      mapRoles(COLORS, { extensions: { colorMeta: three } }),
    ).toThrow("Missing role: text-muted.");
  });

  it("fails on surface with no sidecar at all", () => {
    expect(() => mapRoles(COLORS, null)).toThrow("Missing role: surface.");
  });
});
