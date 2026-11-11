// Deny-by-default helper semantics (07-02, T-07-02-05): own-property reads, trim + cap,
// fresh ids for unsafe input, alt required with an image.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { contentValidators } from "./index";
import {
  MAX_LIST_ITEMS,
  MAX_TEXT,
  asRecord,
  imagePair,
  oneOf,
  own,
  safeId,
  stringList,
  text,
} from "./validate-helpers";

describe("validate-helpers", () => {
  it("asRecord: null/undefined -> {}, non-objects throw", () => {
    expect(asRecord(undefined)).toEqual({});
    expect(asRecord(null)).toEqual({});
    expect(() => asRecord([])).toThrow(InvalidInput);
    expect(() => asRecord("x")).toThrow(InvalidInput);
    const r = { a: 1 };
    expect(asRecord(r)).toBe(r);
  });

  it("own: never reads prototype keys", () => {
    expect(own({}, "__proto__")).toBeUndefined();
    expect(own(Object.create({ a: 1 }) as Record<string, unknown>, "a")).toBe(
      undefined,
    );
    expect(own({ a: 2 }, "a")).toBe(2);
  });

  it("text: trims, coerces non-strings to empty, caps", () => {
    expect(text({ a: "  hi " }, "a")).toBe("hi");
    expect(text({ a: 5 }, "a")).toBe("");
    expect(() => text({ a: "x".repeat(MAX_TEXT + 1) }, "a")).toThrow(
      "Keep this under 500 characters.",
    );
  });

  it("oneOf: falls back on anything not allowed", () => {
    expect(oneOf("x", ["a", "b"], "a")).toBe("a");
    expect(oneOf("b", ["a", "b"], "a")).toBe("b");
    expect(oneOf(7, ["a", "b"], "a")).toBe("a");
  });

  it("safeId: keeps safe ids, replaces unsafe ones", () => {
    expect(safeId("ok_id-1")).toBe("ok_id-1");
    const fresh = safeId("bad id");
    expect(fresh).not.toBe("bad id");
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("stringList: caps the list length and drops non-strings", () => {
    expect(stringList({ a: [" x ", 3, "y"] }, "a")).toEqual(["x", "y"]);
    expect(stringList({ a: "nope" }, "a")).toEqual([]);
    expect(() =>
      stringList(
        { a: Array.from({ length: MAX_LIST_ITEMS + 1 }, () => "x") },
        "a",
      ),
    ).toThrow(InvalidInput);
  });

  it("imagePair: alt is required when a url is set", () => {
    expect(() => imagePair("https://x/y.jpg", "")).toThrow(
      "Add a short description of the image for people who can't see it.",
    );
    expect(() => imagePair("", "")).not.toThrow();
    expect(() => imagePair("https://x/y.jpg", "A cat")).not.toThrow();
  });

  it("is re-exported from @cds/core/content as the contentValidators namespace", () => {
    expect(contentValidators.text).toBe(text);
    expect(contentValidators.own).toBe(own);
  });
});
