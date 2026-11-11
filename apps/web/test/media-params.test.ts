// 07-17 Task 1: Website › Media URL params (choice 5; T-07-17-03).
import { describe, expect, it } from "vitest";
import {
  mediaFiltered,
  mediaHref,
  parseMediaParams,
} from "../app/(platform)/hub/website/media-params";

describe("parseMediaParams", () => {
  it("parses the closed key set", () => {
    expect(
      parseMediaParams({
        tab: "media",
        type: "videos",
        q: "  tour ",
        asset: "abc123",
        view: "describe",
      }),
    ).toEqual({ type: "videos", q: "tour", asset: "abc123", view: "describe" });
  });

  it("drops unknown values and never throws", () => {
    expect(parseMediaParams({ type: "bogus" })).toEqual({ type: "all", q: "" });
    expect(parseMediaParams({ asset: "../x" })).toEqual({ type: "all", q: "" });
    expect(parseMediaParams({ asset: "a".repeat(40) })).toEqual({
      type: "all",
      q: "",
    });
    expect(parseMediaParams({ view: "grid" })).toEqual({ type: "all", q: "" });
    expect(parseMediaParams({})).toEqual({ type: "all", q: "" });
  });

  it("arrays take the first element; q is capped at 100", () => {
    expect(parseMediaParams({ type: ["images", "videos"] }).type).toBe(
      "images",
    );
    expect(parseMediaParams({ q: "x".repeat(300) }).q).toHaveLength(100);
  });
});

describe("mediaHref", () => {
  const base = parseMediaParams({ type: "videos", q: "tour" });

  it("builds /hub/website?tab=media from the closed keys", () => {
    expect(mediaHref(base)).toBe("/hub/website?tab=media&type=videos&q=tour");
    expect(mediaHref(base, { asset: "abc" })).toBe(
      "/hub/website?tab=media&type=videos&q=tour&asset=abc",
    );
  });

  it("drops empties and the default filter", () => {
    expect(mediaHref(base, { type: "all", q: "" })).toBe(
      "/hub/website?tab=media",
    );
    expect(mediaHref(base, { q: null })).toBe(
      "/hub/website?tab=media&type=videos",
    );
  });

  it("never copies unknown keys or bad ids", () => {
    const href = mediaHref(base, {
      asset: "../x",
      org: "o2",
    } as never);
    expect(href).toBe("/hub/website?tab=media&type=videos&q=tour");
    expect(mediaHref(base, { view: "describe" })).toBe(
      "/hub/website?tab=media&type=videos&q=tour&view=describe",
    );
  });

  it("mediaFiltered is true with a type or a search", () => {
    expect(mediaFiltered(parseMediaParams({}))).toBe(false);
    expect(mediaFiltered(base)).toBe(true);
    expect(mediaFiltered(parseMediaParams({ q: "x" }))).toBe(true);
  });
});
