// 13-15 (STAFF-09, D96): pure canned reply placeholder render.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  CANNED_TOKENS,
  cannedPlaceholders,
  fillKnownCanned,
  renderCanned,
} from "./canned";

const VARS = {
  first_name: "Maria",
  business: "Rivera Bakery",
  ticket: 1042,
  agent: "Mara",
};

describe("CANNED_TOKENS", () => {
  it("is the closed allowlist of four", () => {
    expect([...CANNED_TOKENS]).toEqual([
      "first_name",
      "business",
      "ticket",
      "agent",
    ]);
  });
});

describe("cannedPlaceholders", () => {
  it("lists every token found, in order, once each", () => {
    expect(
      cannedPlaceholders("Hi {first_name}, {price} and {first_name}"),
    ).toEqual(["first_name", "price"]);
  });
  it("returns [] for plain text", () => {
    expect(cannedPlaceholders("No tokens here")).toEqual([]);
  });
});

describe("renderCanned", () => {
  it("fills first name and ticket number with #", () => {
    expect(renderCanned("Hi {first_name}, about {ticket}", VARS)).toBe(
      "Hi Maria, about #1042",
    );
  });
  it("refuses an unknown token with PLACEHOLDER-UNKNOWN naming it", () => {
    expect(() => renderCanned("{price}", VARS)).toThrow(InvalidInput);
    expect(() => renderCanned("{price}", VARS)).toThrow(
      "{price} isn't a placeholder. Use {first_name}, {business}, {ticket} or {agent}.",
    );
  });
  it("names the first unknown token", () => {
    expect(() => renderCanned("{agent} {foo} {bar}", VARS)).toThrow(
      /^\{foo\} isn't/,
    );
  });
  it("returns a body with no tokens unchanged", () => {
    expect(renderCanned("Thanks!\n\nCDS", VARS)).toBe("Thanks!\n\nCDS");
  });
  it("replaces repeated tokens", () => {
    expect(renderCanned("{agent} {business} {agent} {business}", VARS)).toBe(
      "Mara Rivera Bakery Mara Rivera Bakery",
    );
  });
  it("does not re-expand placeholders inside values", () => {
    expect(
      renderCanned("Hi {first_name}", { ...VARS, first_name: "{business}" }),
    ).toBe("Hi {business}");
  });
  it("accepts a ticket already written with #", () => {
    expect(renderCanned("{ticket}", { ...VARS, ticket: "#7" })).toBe("#7");
  });
});

describe("fillKnownCanned (WR-E09)", () => {
  it("fills known tokens and leaves any other {word} as typed", () => {
    expect(
      fillKnownCanned("Hi {first_name}, {title} on {ticket}", {
        first_name: "Maria",
        business: "Rivera Bakery",
        ticket: 1042,
        agent: "Mara",
      }),
    ).toBe("Hi Maria, {title} on #1042");
  });
});
