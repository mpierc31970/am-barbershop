// The value grammars shared by the validator and the emitter (THEME-02, T-04-11).
import { describe, expect, it } from "vitest";
import {
  isHexColor,
  isOverlayShadow,
  isRadius,
  isSizeToken,
  toPx,
} from "./grammar";

const INJECTIONS = [
  "18px;}",
  "18px; }",
  "clamp(1rem,url(x),2rem)",
  "</style>",
  "red",
  "expression(1)",
  "18px\n",
  " 18px",
  "",
  "var(--x)",
  "calc(18px)",
];

describe("isHexColor", () => {
  it("accepts lowercase #rrggbb only", () => {
    expect(isHexColor("#fbfaf8")).toBe(true);
    expect(isHexColor("#FFFFFF")).toBe(false);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("#fbfaf8;")).toBe(false);
    expect(isHexColor(16777215)).toBe(false);
    for (const v of INJECTIONS) expect(isHexColor(v)).toBe(false);
  });
});

describe("toPx", () => {
  it("converts px and rem on a 16px root", () => {
    expect(toPx("18px")).toBe(18);
    expect(toPx("1.125rem")).toBe(18);
    expect(toPx("1.28rem")).toBeCloseTo(20.48, 10);
  });

  it("is null for anything else", () => {
    expect(toPx("abc")).toBeNull();
    expect(toPx("4vw")).toBeNull();
    expect(toPx("18")).toBeNull();
    expect(toPx("-18px")).toBeNull();
    expect(toPx("18px;")).toBeNull();
  });
});

describe("isSizeToken", () => {
  it("bounds body and h3", () => {
    expect(isSizeToken("body", "18px")).toBe(true);
    expect(isSizeToken("body", "1.125rem")).toBe(true);
    expect(isSizeToken("body", "15px")).toBe(false);
    expect(isSizeToken("body", "21px")).toBe(false);
    expect(isSizeToken("h3", "22px")).toBe(true);
    expect(isSizeToken("h3", "30px")).toBe(false);
  });

  it("accepts px or a bounded clamp() for h2", () => {
    expect(isSizeToken("h2", "40px")).toBe(true);
    expect(isSizeToken("h2", "45px")).toBe(false);
    expect(isSizeToken("h2", "clamp(1.75rem, 3vw + 1rem, 2.75rem)")).toBe(true);
    expect(isSizeToken("h2", "clamp(1rem, 3vw, 2rem)")).toBe(false);
  });

  it("requires a clamp() with min >= 2.25rem and max <= 6rem for display", () => {
    expect(isSizeToken("display", "clamp(2.5rem, 4vw + 1rem, 3.5rem)")).toBe(
      true,
    );
    expect(isSizeToken("display", "clamp(2.75rem, 5vw + 1rem, 4.5rem)")).toBe(
      true,
    );
    expect(isSizeToken("display", "clamp(2.5rem, 6vw + 0.5rem, 5rem)")).toBe(
      true,
    );
    expect(isSizeToken("display", "clamp(2rem, 10vw, 9rem)")).toBe(false);
    expect(isSizeToken("display", "clamp(2.5rem, 10vw, 7rem)")).toBe(false);
    expect(isSizeToken("display", "clamp(4rem, 10vw, 3rem)")).toBe(false);
    expect(isSizeToken("display", "56px")).toBe(false);
  });

  it("rejects every injection probe for every token", () => {
    for (const token of ["body", "h3", "h2", "display"] as const) {
      for (const v of INJECTIONS) expect(isSizeToken(token, v)).toBe(false);
      expect(isSizeToken(token, "clamp(2.5rem, 4vw + 1rem, 3.5rem);}")).toBe(
        false,
      );
      expect(isSizeToken(token, "clamp(2.5rem, 4vw * 9, 3.5rem)")).toBe(false);
    }
  });
});

describe("isRadius", () => {
  it("bounds button and media radii", () => {
    expect(isRadius("button", "999px")).toBe(true);
    expect(isRadius("button", "0px")).toBe(true);
    expect(isRadius("button", "1000px")).toBe(false);
    expect(isRadius("media", "12px")).toBe(true);
    expect(isRadius("media", "12.5px")).toBe(true);
    expect(isRadius("media", "12.25px")).toBe(false);
    expect(isRadius("media", "25px")).toBe(false);
    expect(isRadius("media", "1rem")).toBe(false);
  });

  it("rejects injection probes", () => {
    for (const v of INJECTIONS) {
      expect(isRadius("button", v)).toBe(false);
      expect(isRadius("media", v)).toBe(false);
    }
  });
});

describe("isOverlayShadow", () => {
  it("accepts the theme overlays", () => {
    expect(isOverlayShadow("0 16px 48px rgb(0 0 0 / 0.18)")).toBe(true);
    expect(isOverlayShadow("0 18px 48px rgb(42 33 27 / 0.20)")).toBe(true);
    expect(isOverlayShadow("0 20px 56px -4px rgb(15 29 38 / 0.22)")).toBe(true);
  });

  it("rejects zero blur, y <= 0 and out-of-range channels", () => {
    expect(isOverlayShadow("0 16px 0px rgb(0 0 0 / 0.18)")).toBe(false);
    expect(isOverlayShadow("0 0 48px rgb(0 0 0 / 0.18)")).toBe(false);
    expect(isOverlayShadow("0 -4px 48px rgb(0 0 0 / 0.18)")).toBe(false);
    expect(isOverlayShadow("0 16px 48px rgb(256 0 0 / 0.18)")).toBe(false);
    expect(isOverlayShadow("0 16px 48px rgb(0 0 0 / 1.5)")).toBe(false);
  });

  it("rejects injection probes and extra layers", () => {
    for (const v of INJECTIONS) expect(isOverlayShadow(v)).toBe(false);
    expect(
      isOverlayShadow(
        "0 16px 48px rgb(0 0 0 / 0.18), 0 1px 2px rgb(0 0 0 / 0.1)",
      ),
    ).toBe(false);
    expect(isOverlayShadow("0 16px 48px rgb(0 0 0 / 0.18);}")).toBe(false);
    expect(isOverlayShadow("inset 0 16px 48px rgb(0 0 0 / 0.18)")).toBe(false);
  });
});
