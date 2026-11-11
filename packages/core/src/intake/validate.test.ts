// T-06-12: every intake input is allow-listed, length-capped and shape-checked with owner copy.
import { describe, expect, it } from "vitest";
import { parseCsv, validateRows } from "../csv";
import { InvalidInput } from "../errors";
import {
  SERVICES_CSV,
  TEAM_CSV,
  validateAnswersPatch,
  validateProfilePatch,
  validateService,
  validateTeamMember,
} from "./index";

describe("validateProfilePatch", () => {
  it("keeps allow-listed keys only", () => {
    const out = validateProfilePatch({
      tagline: " Sourdough daily ",
      role: "owner",
      __proto__: { x: 1 },
    });
    expect(out).toEqual({ tagline: "Sourdough daily" });
  });

  it("normalises and checks the public email", () => {
    expect(validateProfilePatch({ public_email: " Maria@Gmail.com" })).toEqual({
      public_email: "maria@gmail.com",
    });
    expect(validateProfilePatch({ public_email: "" })).toEqual({
      public_email: "",
    });
    expect(() => validateProfilePatch({ public_email: "maria" })).toThrow(
      InvalidInput,
    );
  });

  it("checks the GA4 id pattern", () => {
    expect(validateProfilePatch({ ga4_id: "g-abc123XYZ" })).toEqual({
      ga4_id: "G-ABC123XYZ",
    });
    expect(() => validateProfilePatch({ ga4_id: "UA-12345-1" })).toThrow(
      InvalidInput,
    );
  });

  it("social links must be http(s) on a known platform", () => {
    expect(
      validateProfilePatch({
        socials: [{ platform: "instagram", url: "https://instagram.com/rb" }],
      }),
    ).toEqual({
      socials: [{ platform: "instagram", url: "https://instagram.com/rb" }],
    });
    expect(() =>
      validateProfilePatch({
        socials: [{ platform: "instagram", url: "javascript:alert(1)" }],
      }),
    ).toThrow(InvalidInput);
    expect(() =>
      validateProfilePatch({
        socials: [{ platform: "myspace", url: "https://x.com" }],
      }),
    ).toThrow(InvalidInput);
  });

  it("caps tagline 80, description 200, about 2000", () => {
    expect(() => validateProfilePatch({ tagline: "a".repeat(81) })).toThrow(
      InvalidInput,
    );
    expect(() =>
      validateProfilePatch({ description: "a".repeat(201) }),
    ).toThrow(InvalidInput);
    expect(() => validateProfilePatch({ about: "a".repeat(2001) })).toThrow(
      InvalidInput,
    );
    expect(
      validateProfilePatch({ about: "a".repeat(2000) }).about,
    ).toHaveLength(2000);
  });

  it("validates time zone, hours, business type and font pairing", () => {
    expect(() => validateProfilePatch({ time_zone: "Mars/Base" })).toThrow(
      InvalidInput,
    );
    expect(validateProfilePatch({ hours: null })).toEqual({ hours: null });
    expect(() => validateProfilePatch({ business_type: "casino" })).toThrow(
      InvalidInput,
    );
    expect(validateProfilePatch({ business_type: "bakery" })).toEqual({
      business_type: "bakery",
    });
    expect(validateProfilePatch({ font_pairing: "bold-clear" })).toEqual({
      font_pairing: "bold-clear",
    });
    expect(() => validateProfilePatch({ font_pairing: "comic" })).toThrow(
      InvalidInput,
    );
  });

  it("checks the address shape", () => {
    expect(
      validateProfilePatch({
        address: {
          street: "1 Main St",
          city: "Austin",
          state: "TX",
          zip: "78701",
          extra: 1,
        },
      }),
    ).toEqual({
      address: {
        street: "1 Main St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
    });
    expect(() => validateProfilePatch({ address: "Austin" })).toThrow(
      InvalidInput,
    );
  });

  it("rejects a non-object", () => {
    expect(() => validateProfilePatch("x")).toThrow(InvalidInput);
    expect(() => validateProfilePatch([])).toThrow(InvalidInput);
  });

  it("refuses control characters (terminal escapes) but keeps line breaks and tabs (A-WR-10)", () => {
    expect(() =>
      validateProfilePatch({ description: "Bakery\u001b[2K\u001b[1A" }),
    ).toThrow("Remove the hidden control characters");
    expect(() => validateProfilePatch({ about: "a\u0007b" })).toThrow(
      InvalidInput,
    );
    expect(() => validateProfilePatch({ tagline: "a\u009bb" })).toThrow(
      InvalidInput,
    );
    expect(
      validateProfilePatch({ about: "Line one.\r\nLine two.\tTabbed." }).about,
    ).toBe("Line one.\r\nLine two.\tTabbed.");
  });
});

describe("validateAnswersPatch", () => {
  it("normalises a pasted domain", () => {
    expect(
      validateAnswersPatch({ domain: "https://www.RiveraBakery.com/" }),
    ).toEqual({ domain: "riverabakery.com" });
    expect(validateAnswersPatch({ domain: "" })).toEqual({ domain: "" });
    expect(() => validateAnswersPatch({ domain: "rivera bakery" })).toThrow(
      InvalidInput,
    );
  });

  it("checks enums and drops unknown keys", () => {
    expect(
      validateAnswersPatch({ domain_choice: "have", gbp: "not_sure", x: 1 }),
    ).toEqual({ domain_choice: "have", gbp: "not_sure" });
    expect(() => validateAnswersPatch({ domain_choice: "maybe" })).toThrow(
      InvalidInput,
    );
    expect(() => validateAnswersPatch({ registrar: "evil" })).toThrow(
      InvalidInput,
    );
  });
});

describe("validateTeamMember / validateService", () => {
  it("a team member needs a name and defaults to shown", () => {
    expect(validateTeamMember({ name: " Maria " })).toEqual({
      name: "Maria",
      role: "",
      bio: "",
      is_published: true,
    });
    expect(() => validateTeamMember({ name: "" })).toThrow(InvalidInput);
    expect(() =>
      validateTeamMember({ name: "M", bio: "a".repeat(601) }),
    ).toThrow(InvalidInput);
  });

  it("a fixed price needs price_cents > 0", () => {
    expect(() =>
      validateService({
        name: "Haircut",
        price_display: "fixed",
        price_cents: 0,
      }),
    ).toThrow(InvalidInput);
    expect(
      validateService({
        name: "Haircut",
        price_display: "from",
        price_cents: 4500,
      }).price_cents,
    ).toBe(4500);
  });

  it("free and ask force price_cents null", () => {
    expect(
      validateService({
        name: "Chat",
        price_display: "free",
        price_cents: 4500,
      }).price_cents,
    ).toBeNull();
    expect(
      validateService({ name: "Chat", price_display: "ask", price_cents: 4500 })
        .price_cents,
    ).toBeNull();
  });

  it("duration is one of the offered lengths or null", () => {
    expect(
      validateService({
        name: "Cut",
        price_display: "ask",
        duration_minutes: 60,
      }).duration_minutes,
    ).toBe(60);
    expect(
      validateService({
        name: "Cut",
        price_display: "ask",
        duration_minutes: null,
      }).duration_minutes,
    ).toBeNull();
    expect(() =>
      validateService({
        name: "Cut",
        price_display: "ask",
        duration_minutes: 50,
      }),
    ).toThrow(InvalidInput);
  });

  it("rejects an unknown price display", () => {
    expect(() =>
      validateService({ name: "Cut", price_display: "cheap" }),
    ).toThrow(InvalidInput);
  });
});

describe("TEAM_CSV / SERVICES_CSV (D120)", () => {
  it("parses price types, prices and show on site", () => {
    const parsed = parseCsv(
      [
        "Name,Description,Price type,Price,Duration in minutes,Show on site",
        "Haircut,,Starting at,45.00,60,yes",
        "Consult,,Ask,,,no",
        "Bad,,Cheap,,,",
      ].join("\n"),
    );
    if (!parsed.ok) throw new Error("parse failed");
    const result = validateRows(parsed, SERVICES_CSV);
    if (!result.ok) throw new Error("validate failed");
    const [a, b, c] = result.rows;
    expect(a!.values).toMatchObject({
      price_display: "from",
      price_cents: 4500,
      duration_minutes: 60,
      is_published: true,
    });
    expect(b!.values).toMatchObject({
      price_display: "ask",
      is_published: false,
    });
    expect(c!.errors).toContain(
      "Row 4: Price type must be Fixed, Starting at, Free or Ask.",
    );
    expect(SERVICES_CSV.collection).toBe("services");
    expect(SERVICES_CSV.naturalKey).toEqual(["name"]);
  });

  it("team show on site is yes/no", () => {
    const col = TEAM_CSV.columns.find((c) => c.key === "is_published")!;
    expect(col.parse("yes")).toEqual({ ok: true, value: true });
    expect(col.parse("No")).toEqual({ ok: true, value: false });
    expect(col.parse("maybe").ok).toBe(false);
    expect(TEAM_CSV.collection).toBe("team_members");
    expect(TEAM_CSV.columns.map((c) => c.key)).toEqual([
      "name",
      "role",
      "bio",
      "is_published",
    ]);
  });

  it("price column rejects junk and formats cents", () => {
    const col = SERVICES_CSV.columns.find((c) => c.key === "price_cents")!;
    expect(col.parse("$45")).toEqual({ ok: true, value: 4500 });
    expect(col.parse("12.5")).toEqual({ ok: true, value: 1250 });
    expect(col.parse("")).toEqual({ ok: true, value: null });
    expect(col.parse("forty").ok).toBe(false);
    expect(col.format(4500)).toBe("45.00");
  });
});
