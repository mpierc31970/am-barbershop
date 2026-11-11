// pages.version_refs helpers (07-12 choice 11; CONT-36, D275).
import { describe, expect, it } from "vitest";
import {
  buildVersionRefs,
  parseVersionRefs,
  VERSIONS_KEPT,
  versionRefsHas,
} from "./version-refs";

const A = "aaaaaaaaaaaaaa1";
const B = "bbbbbbbbbbbbbb2";
const C = "ccccccccccccccc";
const refs = (
  media: string[],
  popups: string[] = [],
  forms: string[] = [],
) => ({
  popups,
  forms,
  media,
});

describe("buildVersionRefs", () => {
  it("unions per key in version order, first seen", () => {
    const v = buildVersionRefs({
      "2026-01-02.json": refs([B, A], [C]),
      "2026-01-01.json": refs([A]),
    });
    expect(v.v).toBe(1);
    expect(v.union).toEqual({ popups: [C], forms: [], media: [A, B] });
    expect(Object.keys(v.versions)).toEqual([
      "2026-01-01.json",
      "2026-01-02.json",
    ]);
  });

  it("keeps only the newest VERSIONS_KEPT entries", () => {
    const entries: Record<string, ReturnType<typeof refs>> = {};
    for (let i = 0; i < 12; i += 1) {
      entries[`2026-01-${String(i + 10)}.json`] = refs(i === 0 ? [A] : [B]);
    }
    const v = buildVersionRefs(entries);
    expect(Object.keys(v.versions)).toHaveLength(VERSIONS_KEPT);
    expect(v.versions["2026-01-10.json"]).toBeUndefined();
    expect(v.union.media).toEqual([B]);
  });
});

describe("parseVersionRefs", () => {
  it.each([
    null,
    "x",
    { v: 2, union: refs([]), versions: {} },
    { v: 1, union: refs([]) },
    {
      v: 1,
      union: refs([]),
      versions: { "a.json": { popups: [], forms: [] } },
    },
    { v: 1, union: refs([]), versions: { "a.json": refs(["NOT AN ID"]) } },
    { v: 1, union: refs([]), versions: { "a.json": refs([42 as never]) } },
    { v: 1, union: refs([]), versions: { "../x": refs([]) } },
    { v: 1, union: "x", versions: {} },
  ])("refuses %j", (raw) => {
    expect(parseVersionRefs(raw)).toBeNull();
  });

  it("round-trips a valid value and recomputes the union", () => {
    const v = buildVersionRefs({ "2026-01-01.json": refs([A], [B]) });
    expect(parseVersionRefs(JSON.parse(JSON.stringify(v)))).toEqual(v);
    const tampered = { ...v, union: refs([C]) };
    expect(parseVersionRefs(tampered)!.union.media).toEqual([A]);
  });
});

describe("versionRefsHas", () => {
  it("checks the union", () => {
    const v = buildVersionRefs({ "2026-01-01.json": refs([A], [B]) });
    expect(versionRefsHas(v, "media", A)).toBe(true);
    expect(versionRefsHas(v, "popups", B)).toBe(true);
    expect(versionRefsHas(v, "media", B)).toBe(false);
    expect(versionRefsHas(null, "media", A)).toBe(false);
  });
});
