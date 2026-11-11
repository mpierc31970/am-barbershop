// DOM-05: authoritative sweep name lists (14-05 choice 3; RESEARCH Pattern 2).
import { describe, expect, it } from "vitest";
import {
  APEX_TYPES,
  COMMON_HOSTS,
  DKIM_SELECTORS,
  MAIL_SRV_NAMES,
  sweepNames,
} from "./selectors";

describe("lists", () => {
  it("are frozen and unique", () => {
    for (const l of [
      DKIM_SELECTORS,
      COMMON_HOSTS,
      MAIL_SRV_NAMES,
      APEX_TYPES,
    ]) {
      expect(Object.isFrozen(l)).toBe(true);
      expect(new Set(l).size).toBe(l.length);
    }
  });

  it("has the verified Titan selector and the common providers", () => {
    for (const s of [
      "titan1",
      "google",
      "selector1",
      "selector2",
      "zmail",
      "k1",
      "s1",
      "amazonses",
    ]) {
      expect(DKIM_SELECTORS).toContain(s);
    }
  });
});

describe("sweepNames", () => {
  const out = sweepNames("X.Example.");
  const byName = new Map(out.map((e) => [e.name, e.types]));

  it("starts at the apex with its types", () => {
    expect(out[0]).toEqual({ name: "x.example", types: [...APEX_TYPES] });
  });

  it("covers www, DKIM selectors, _dmarc and mail SRV", () => {
    expect(byName.get("www.x.example")).toEqual(
      expect.arrayContaining(["A", "AAAA", "CNAME"]),
    );
    expect(byName.get("titan1._domainkey.x.example")).toContain("TXT");
    expect(byName.get("selector1._domainkey.x.example")).toContain("CNAME");
    expect(byName.get("_dmarc.x.example")).toContain("TXT");
    expect(byName.get("_autodiscover._tcp.x.example")).toEqual(["SRV"]);
  });

  it("has no duplicate names", () => {
    expect(new Set(out.map((e) => e.name)).size).toBe(out.length);
  });
});
