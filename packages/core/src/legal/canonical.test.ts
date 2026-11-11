// D81, RESEARCH Pattern 2: canonical JSON for evidence hashing.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { canonicalJson } from "./canonical";

describe("canonicalJson", () => {
  it("sorts keys and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe(
      '{"a":[true,null,"x"],"b":1}',
    );
  });

  it("input key order never changes the output", () => {
    expect(canonicalJson({ a: 1, b: { d: 2, c: 3 } })).toBe(
      canonicalJson({ b: { c: 3, d: 2 }, a: 1 }),
    );
  });

  it("sorts nested keys at every level", () => {
    expect(
      canonicalJson({ z: { y: { b: 1, a: 2 } }, a: [{ d: 1, c: 2 }] }),
    ).toBe('{"a":[{"c":2,"d":1}],"z":{"y":{"a":2,"b":1}}}');
  });

  it.each([[1.5], [2 ** 60], [{ a: undefined }], [Number.NaN], [() => 1]])(
    "throws InvalidInput on %o",
    (v) => {
      expect(() => canonicalJson(v)).toThrow(InvalidInput);
    },
  );

  it("strings with quotes and unicode round-trip", () => {
    const v = { s: 'He said "hi" \\ é 漢 😀\n' };
    expect(JSON.parse(canonicalJson(v))).toEqual(v);
  });

  it("negative integers and zero are fine", () => {
    expect(canonicalJson([-3, 0])).toBe("[-3,0]");
  });

  it("IN-B03: refuses non-plain objects, accepts null-prototype ones", () => {
    class Box {
      a = 1;
    }
    for (const v of [new Date(0), new Map(), new Box(), { d: new Date(0) }]) {
      expect(() => canonicalJson(v)).toThrow(InvalidInput);
    }
    const bare = Object.assign(Object.create(null) as object, { a: 1 });
    expect(canonicalJson(bare)).toBe('{"a":1}');
  });
});
