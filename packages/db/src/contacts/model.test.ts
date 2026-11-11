// Contacts model helpers (CONTACTS-01/02, D236, D266, D271, D132): pure unit tests.
import { InvalidInput } from "@cds/core";
import { describe, expect, it } from "vitest";
import {
  clampTouch,
  CONSENT_FILTERS,
  consentStatusOf,
  ContactExists,
  fillBlanks,
  mergeConsent,
  NAME_MAX,
  normalizeTags,
  parseTagCell,
  PHONE_MAX,
  readConsent,
  readTags,
  REF_MAX,
  SUMMARY_MAX,
} from "./model";

const AT = "2026-10-05T10:00:00.000Z";
const tick = {
  wording: "Send me news and offers by email.",
  form: "form123",
  source: "form" as const,
  at: AT,
};

describe("normalizeTags", () => {
  it("trims, collapses spaces, dedupes case-insensitively and drops blanks", () => {
    expect(
      normalizeTags(["  Spring  fair ", "spring fair", "VIP", ""]),
    ).toEqual(["Spring fair", "VIP"]);
  });

  it("refuses a tag over 40 characters", () => {
    expect(() => normalizeTags(["x".repeat(41)])).toThrow(InvalidInput);
    expect(normalizeTags(["x".repeat(40)])).toEqual(["x".repeat(40)]);
  });

  it("refuses more than 20 tags", () => {
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(() => normalizeTags(many)).toThrow(InvalidInput);
    expect(normalizeTags(many.slice(0, 20))).toHaveLength(20);
  });

  it("refuses a non-array and non-string items", () => {
    expect(() => normalizeTags("VIP")).toThrow(InvalidInput);
    expect(() => normalizeTags([1])).toThrow(InvalidInput);
  });

  it("keeps a formula-looking tag as literal text (the export guards it)", () => {
    expect(normalizeTags(['=HYPERLINK("x")'])).toEqual(['=HYPERLINK("x")']);
  });

  it("readTags is lenient on stored data and never throws", () => {
    expect(readTags(null)).toEqual([]);
    expect(readTags(["VIP", 3, " vip ", "News"])).toEqual(["VIP", "News"]);
  });
});

describe("parseTagCell", () => {
  it("splits on ; or , and dedupes", () => {
    expect(parseTagCell("VIP; Spring fair, vip")).toEqual([
      "VIP",
      "Spring fair",
    ]);
    expect(parseTagCell("   ")).toEqual([]);
  });
});

describe("consent (D271, D132)", () => {
  it("consentStatusOf always returns one of the four statuses", () => {
    expect(consentStatusOf({ status: "confirmed" })).toBe("confirmed");
    expect(consentStatusOf({ status: "subscribed" })).toBe("none");
    expect(consentStatusOf("confirmed")).toBe("none");
    expect(consentStatusOf(null)).toBe("none");
  });

  it("an undefined incoming returns the existing value", () => {
    const existing = {
      status: "unconfirmed",
      at: AT,
      source: "form",
      wording: "w",
    };
    expect(mergeConsent(existing, undefined)).toEqual(existing);
  });

  it("none + agreement -> unconfirmed with at, source, wording and form", () => {
    expect(mergeConsent({ status: "none" }, tick)).toEqual({
      status: "unconfirmed",
      at: AT,
      source: "form",
      wording: tick.wording,
      form: "form123",
    });
  });

  it("confirmed is never downgraded by a touch", () => {
    const c = { status: "confirmed", at: "2026-01-01", source: "subscribe" };
    expect(mergeConsent(c, tick)).toEqual(c);
  });

  it("unconfirmed keeps the first agreement", () => {
    const first = {
      status: "unconfirmed",
      at: "2026-01-01",
      source: "form",
      wording: "old",
    };
    expect(mergeConsent(first, tick)).toEqual(first);
  });

  it("withdrawn + a fresh tick -> unconfirmed with the new wording", () => {
    const out = mergeConsent(
      { status: "withdrawn", at: "2026-01-01", source: "owner" },
      tick,
    );
    expect(out.status).toBe("unconfirmed");
    expect(out.wording).toBe(tick.wording);
  });

  it("a malformed existing value reads as none", () => {
    expect(readConsent("nope")).toEqual({ status: "none" });
    expect(mergeConsent([1, 2], undefined)).toEqual({ status: "none" });
    expect(mergeConsent({ status: 5 }, tick).status).toBe("unconfirmed");
  });

  it("CONSENT_FILTERS maps owner words to statuses", () => {
    expect(CONSENT_FILTERS).toEqual({
      subscribed: "confirmed",
      unconfirmed: "unconfirmed",
      unsubscribed: "withdrawn",
      none: "none",
    });
  });
});

describe("fillBlanks", () => {
  it("fills only empty stored values and never overwrites", () => {
    expect(
      fillBlanks({ name: "Maria", phone: "" }, { name: "M. L.", phone: "512" }),
    ).toEqual({
      phone: "512",
    });
    expect(fillBlanks({ name: "", phone: "1" }, { name: "Sam" })).toEqual({
      name: "Sam",
    });
    expect(fillBlanks({ name: "", phone: "" }, { name: "  " })).toEqual({});
  });
});

describe("clampTouch", () => {
  it("truncates a 10 000-char name and long fields", () => {
    const t = clampTouch({
      email: "a@b.co",
      source: "form",
      name: "n".repeat(10_000),
      phone: "1".repeat(100),
      summary: "s".repeat(1000),
      ref: "r".repeat(100),
    });
    expect(t.name).toHaveLength(NAME_MAX);
    expect(t.phone).toHaveLength(PHONE_MAX);
    expect(t.summary).toHaveLength(SUMMARY_MAX);
    expect(t.ref).toHaveLength(REF_MAX);
  });

  it("strips control characters and trims", () => {
    const t = clampTouch({
      email: "a@b.co",
      source: "form",
      name: "  Maria\u0000 ",
      summary: "Sent\u0000 the\u0007 form",
    });
    expect(t.name).toBe("Maria");
    expect(t.summary).toBe("Sent the form");
  });

  it("refuses an unknown source", () => {
    expect(() =>
      clampTouch({ email: "a@b.co", source: "hack" as never }),
    ).toThrow(InvalidInput);
  });
});

describe("ContactExists", () => {
  it("is an InvalidInput carrying the id and label (DUP-CONTACT)", () => {
    const e = new ContactExists("maria@example.com", "c1", "Maria Lopez");
    expect(e).toBeInstanceOf(InvalidInput);
    expect(e.message).toBe("maria@example.com is already a contact.");
    expect(e.contactId).toBe("c1");
    expect(e.label).toBe("Maria Lopez");
    expect(new ContactExists("x@y.co", "c2", "").label).toBe("x@y.co");
  });
});
