// Announcement banner (CONT-11, D117, D123; RESEARCH Pitfall 9; T-03-13).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  BANNER_MESSAGE_MAX,
  bannerState,
  bannerStatusLine,
  isBannerVisible,
  validateBanner,
  type BannerSettings,
} from "./banner";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

const BASE: BannerSettings = {
  enabled: true,
  message: "Spring sale this week",
  link_text: "",
  link_url: "",
  starts_at: null,
  ends_at: null,
};

describe("validateBanner", () => {
  it("accepts a plain enabled banner", () => {
    expect(validateBanner({ ...BASE })).toEqual(BASE);
  });

  it("defaults an empty input to off", () => {
    expect(validateBanner(undefined)).toEqual({
      enabled: false,
      message: "",
      link_text: "",
      link_url: "",
      starts_at: null,
      ends_at: null,
    });
  });

  it("caps the message at 140 characters", () => {
    expect(BANNER_MESSAGE_MAX).toBe(140);
    expect(() =>
      validateBanner({ ...BASE, message: "x".repeat(140) }),
    ).not.toThrow();
    expect(
      msg(() => validateBanner({ ...BASE, message: "x".repeat(141) })),
    ).toBe("Keep this under 140 characters.");
  });

  it("requires a message when the banner is on", () => {
    expect(msg(() => validateBanner({ ...BASE, message: "  " }))).toBe(
      "Write the message visitors see in the banner.",
    );
    expect(() =>
      validateBanner({ ...BASE, enabled: false, message: "" }),
    ).not.toThrow();
  });

  it("requires a link URL when link text is set", () => {
    expect(
      msg(() => validateBanner({ ...BASE, link_text: "Shop", link_url: "" })),
    ).toBe("Add the address this link goes to.");
  });

  it("requires link text when a link URL is set", () => {
    expect(
      msg(() => validateBanner({ ...BASE, link_url: "https://x.test/" })),
    ).toBe("Add the words visitors click for this link.");
  });

  it("rejects javascript: links", () => {
    expect(() =>
      validateBanner({ ...BASE, link_text: "Go", link_url: "javascript:x" }),
    ).toThrow(InvalidInput);
  });

  it("accepts a site path link", () => {
    expect(
      validateBanner({ ...BASE, link_text: "Shop", link_url: "/shop" })
        .link_url,
    ).toBe("/shop");
  });

  it("rejects an end before the start", () => {
    const m = msg(() =>
      validateBanner({
        ...BASE,
        starts_at: "2026-10-12T09:00:00Z",
        ends_at: "2026-10-11T09:00:00Z",
      }),
    );
    expect(m.startsWith("The end time is before the start time.")).toBe(true);
    expect(m).toBe(
      "The end time is before the start time. Pick an end after 12 Oct, 9:00 am.",
    );
  });

  it("rejects an end equal to the start", () => {
    expect(() =>
      validateBanner({
        ...BASE,
        starts_at: "2026-10-12T09:00:00Z",
        ends_at: "2026-10-12T09:00:00Z",
      }),
    ).toThrow(InvalidInput);
  });

  it("rejects an unparseable date", () => {
    expect(msg(() => validateBanner({ ...BASE, starts_at: "soon" }))).toBe(
      "Choose a valid date and time.",
    );
  });

  it("re-emits dates as ISO and blanks as null", () => {
    const out = validateBanner({
      ...BASE,
      starts_at: "2026-10-12T09:00:00+02:00",
      ends_at: "",
    });
    expect(out.starts_at).toBe("2026-10-12T07:00:00.000Z");
    expect(out.ends_at).toBeNull();
  });

  it("drops unknown keys and ignores inherited ones", () => {
    const out = validateBanner({ ...BASE, onclick: "x", style: "y" });
    expect(Object.keys(out).sort()).toEqual([
      "enabled",
      "ends_at",
      "link_text",
      "link_url",
      "message",
      "starts_at",
    ]);
    const proto = Object.create({ message: "inherited" }) as object;
    expect(validateBanner(proto).message).toBe("");
  });

  it("treats only true as enabled", () => {
    expect(validateBanner({ ...BASE, enabled: "true" }).enabled).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(() => validateBanner("x")).toThrow(InvalidInput);
  });
});

const NOW = new Date("2026-10-15T12:00:00Z");

describe("bannerState", () => {
  it("is off when missing or disabled", () => {
    expect(bannerState(null, NOW)).toBe("off");
    expect(bannerState({ ...BASE, enabled: false }, NOW)).toBe("off");
  });

  it("is off when enabled with no message", () => {
    expect(bannerState({ ...BASE, message: "" }, NOW)).toBe("off");
  });

  it("is always with no schedule", () => {
    expect(bannerState(BASE, NOW)).toBe("always");
  });

  it("is scheduled before the start", () => {
    expect(
      bannerState({ ...BASE, starts_at: "2026-10-16T00:00:00Z" }, NOW),
    ).toBe("scheduled");
  });

  it("is active inside the window, start inclusive", () => {
    const b = {
      ...BASE,
      starts_at: "2026-10-15T12:00:00Z",
      ends_at: "2026-10-19T23:59:00Z",
    };
    expect(bannerState(b, NOW)).toBe("active");
  });

  it("is ended at or after the end", () => {
    const b = { ...BASE, ends_at: "2026-10-15T12:00:00Z" };
    expect(bannerState(b, NOW)).toBe("ended");
    expect(bannerState(b, new Date("2026-10-15T11:59:59Z"))).toBe("active");
  });

  it("is active when only a passed start is set", () => {
    expect(
      bannerState({ ...BASE, starts_at: "2026-10-01T00:00:00Z" }, NOW),
    ).toBe("active");
  });
});

describe("isBannerVisible", () => {
  it("shows always and active only", () => {
    expect(isBannerVisible(BASE, NOW)).toBe(true);
    expect(
      isBannerVisible({ ...BASE, starts_at: "2026-10-01T00:00:00Z" }, NOW),
    ).toBe(true);
    expect(
      isBannerVisible({ ...BASE, starts_at: "2026-10-16T00:00:00Z" }, NOW),
    ).toBe(false);
    expect(
      isBannerVisible({ ...BASE, ends_at: "2026-10-01T00:00:00Z" }, NOW),
    ).toBe(false);
    expect(isBannerVisible(null, NOW)).toBe(false);
  });
});

describe("bannerStatusLine", () => {
  it("matches the UI-SPEC status copy", () => {
    expect(bannerStatusLine(null, NOW)).toBe(
      "Off. Visitors don't see a banner.",
    );
    expect(bannerStatusLine(BASE, NOW)).toBe("Showing on every page now.");
    expect(
      bannerStatusLine(
        {
          ...BASE,
          starts_at: "2026-10-16T09:00:00Z",
          ends_at: "2026-10-19T23:59:00Z",
        },
        NOW,
      ),
    ).toBe("Starts 16 Oct, 9:00 am. Ends 19 Oct, 11:59 pm.");
    expect(
      bannerStatusLine({ ...BASE, ends_at: "2026-10-19T23:59:00Z" }, NOW),
    ).toBe("Showing now until 19 Oct, 11:59 pm.");
    expect(
      bannerStatusLine({ ...BASE, ends_at: "2026-10-03T17:00:00Z" }, NOW),
    ).toBe("Ended 3 Oct, 5:00 pm. Turn it off or pick new dates.");
  });

  it("omits a missing end in the scheduled and active lines", () => {
    expect(
      bannerStatusLine({ ...BASE, starts_at: "2026-10-16T09:00:00Z" }, NOW),
    ).toBe("Starts 16 Oct, 9:00 am.");
    expect(
      bannerStatusLine({ ...BASE, starts_at: "2026-10-01T09:00:00Z" }, NOW),
    ).toBe("Showing on every page now.");
  });
});
