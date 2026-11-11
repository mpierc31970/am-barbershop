// 07-14: consent rules (CONT-34, D279; choices 4, 5, 11).
import { describe, expect, it } from "vitest";
import {
  CONSENT_FRAME_HOSTS,
  consentFrameUrl,
  consentLine,
  consentNeeds,
  consentStatusText,
  cookieText,
  framesIn,
  mapFrameUrl,
  mapPlaceUrl,
  needsConsent,
  parseConsentChoice,
  type ConsentNeeds,
} from "./index";

const YT = "dQw4w9WgXcQ";

const linkVideo = (provider = "youtube", id = YT) => ({
  id: "v1",
  kind: "video",
  title: "Tour",
  source: "link",
  asset: "",
  provider,
  provider_id: id,
});
const columns = (...items: unknown[]) => ({
  id: "s1",
  section_type: "columns",
  content: { columns: [{ items }] },
});

describe("framesIn / consentNeeds", () => {
  it("finds a YouTube link video in columns", () => {
    expect(
      consentNeeds({
        pages: [[columns(linkVideo())]],
        popups: [],
        analytics: false,
      }),
    ).toEqual({
      needed: true,
      frames: [{ kind: "video", provider: "youtube" }],
      analytics: false,
    });
  });

  it("an uploaded MP4 alone needs nothing", () => {
    const mp4 = { ...linkVideo(), source: "media", asset: "abc" };
    expect(
      needsConsent({ pages: [[columns(mp4)]], popups: [], analytics: false }),
    ).toBe(false);
  });

  // A&M fork: map sections render MapLibre + OpenFreeMap (no cookies), so they need no consent.
  it("maps audio and embed items to their kinds in a stable order; map sections need none", () => {
    const frames = framesIn([
      { section_type: "map", content: {} },
      columns(
        { kind: "embed", provider: "calendly", provider_id: "x/y" },
        { kind: "audio", source: "link", provider: "spotify" },
        linkVideo("vimeo"),
      ),
    ]);
    expect(frames).toEqual([
      { kind: "video", provider: "vimeo" },
      { kind: "audio", provider: "spotify" },
      { kind: "booking", provider: "calendly" },
    ]);
  });

  it("finds frames in slider slides, tab panels and enabled pop-ups only", () => {
    const slider = {
      section_type: "slider",
      content: { slides: [{ columns: [{ items: [linkVideo()] }] }] },
    };
    const tabs = {
      section_type: "tabs",
      content: {
        tabs: [{ columns: [{ items: [linkVideo("loom", "a".repeat(32))] }] }],
      },
    };
    expect(framesIn([slider, tabs]).map((f) => f.provider)).toEqual([
      "youtube",
      "loom",
    ]);
    const on = { enabled: true, content: { items: [linkVideo("tiktok")] } };
    const off = { enabled: false, content: { items: [linkVideo("vimeo")] } };
    expect(
      consentNeeds({ pages: [], popups: [on, off], analytics: false }).frames,
    ).toEqual([{ kind: "video", provider: "tiktok" }]);
  });

  it("collapses duplicates", () => {
    expect(framesIn([linkVideo(), linkVideo(), [linkVideo()]])).toHaveLength(1);
  });

  it("ignores unknown providers, prototype keys and wrong categories", () => {
    expect(
      framesIn([
        linkVideo("dailymotion"),
        linkVideo("__proto__"),
        linkVideo("constructor"),
        linkVideo("spotify"),
        { kind: "embed", provider: "youtube" },
        "youtube",
        42,
        null,
      ]),
    ).toEqual([]);
  });

  it("finishes on hostile depth and size, reporting nothing past the limits", () => {
    let deep: unknown = linkVideo();
    for (let i = 0; i < 10_000; i += 1) deep = { child: deep };
    expect(framesIn(deep)).toEqual([]);
    const wide = Array.from({ length: 50_000 }, () => ({ a: 1 }));
    expect(() => framesIn(wide)).not.toThrow();
    expect(framesIn(wide)).toEqual([]);
  });

  it("a walk cut off by the node budget fails closed (WR-B03)", () => {
    const wide = Array.from({ length: 25_000 }, () => ({ a: 1 }));
    const n = consentNeeds({ pages: [wide], popups: [], analytics: false });
    expect(n).toEqual({
      needed: true,
      frames: [],
      analytics: false,
      truncated: true,
    });
    expect(cookieText(n)).toBe(
      "This site uses cookies for embedded content from other companies. Choose what to allow.",
    );
    expect(consentStatusText(n)).toBe(
      "Your site shows a cookie notice because it has embedded content from other companies.",
    );
    expect(
      consentNeeds({ pages: [], popups: [], analytics: false }),
    ).not.toHaveProperty("truncated");
  });

  it("skips gallery photo lists, so big galleries do not exhaust the budget", () => {
    const gallery = {
      id: "g",
      section_type: "gallery",
      content: {
        heading: "",
        images: Array.from({ length: 25_000 }, (_, i) => ({ id: `i${i}` })),
      },
    };
    expect(
      consentNeeds({
        pages: [[gallery, columns(linkVideo())]],
        popups: [],
        analytics: false,
      }),
    ).toEqual({
      needed: true,
      frames: [{ kind: "video", provider: "youtube" }],
      analytics: false,
    });
    // An "images" key outside a gallery's content is still walked.
    expect(framesIn([{ images: [linkVideo()] }])).toHaveLength(1);
  });

  it("analytics alone is needed with no frames", () => {
    expect(consentNeeds({ pages: [], popups: [], analytics: true })).toEqual({
      needed: true,
      frames: [],
      analytics: true,
    });
  });

  it("needsConsent equals consentNeeds(...).needed", () => {
    for (const input of [
      { pages: [], popups: [], analytics: false },
      { pages: [[columns(linkVideo())]], popups: [], analytics: false },
    ]) {
      expect(needsConsent(input)).toBe(consentNeeds(input).needed);
    }
  });
});

describe("consentFrameUrl / mapFrameUrl", () => {
  it("builds privacy-enhanced provider URLs from { provider, id }", () => {
    expect(consentFrameUrl({ kind: "link", provider: "youtube", id: YT })).toBe(
      `https://www.youtube-nocookie.com/embed/${YT}`,
    );
    expect(
      consentFrameUrl({ kind: "link", provider: "vimeo", id: "76979871" }),
    ).toContain("dnt=1");
  });

  it("rejects unknown providers, prototype keys, bad ids and non-objects", () => {
    expect(
      consentFrameUrl({ kind: "link", provider: "evil", id: YT }),
    ).toBeNull();
    expect(
      consentFrameUrl({ kind: "link", provider: "__proto__", id: YT }),
    ).toBeNull();
    expect(
      consentFrameUrl({ kind: "link", provider: "youtube", id: 'x"><' }),
    ).toBeNull();
    expect(consentFrameUrl(null)).toBeNull();
    expect(consentFrameUrl("https://evil.example")).toBeNull();
    expect(consentFrameUrl({ kind: "other" })).toBeNull();
  });

  it("builds map URLs with an encoded query and an optional valid key", () => {
    expect(mapFrameUrl("1 Main St, Austin")).toBe(
      "https://maps.google.com/maps?q=1%20Main%20St%2C%20Austin&output=embed",
    );
    const key = "AIzaSyA-valid_key_1234567890";
    expect(mapFrameUrl("1 Main St, Austin", key)).toBe(
      `https://www.google.com/maps/embed/v1/place?key=${key}&q=1%20Main%20St%2C%20Austin`,
    );
    expect(mapFrameUrl("1 Main St", "bad key&x=1")).toBe(
      "https://maps.google.com/maps?q=1%20Main%20St&output=embed",
    );
    expect(mapFrameUrl("")).toBeNull();
    expect(mapFrameUrl("   ")).toBeNull();
    expect(mapFrameUrl("a".repeat(501))).toBeNull();
    expect(mapFrameUrl("1 Main\nSt")).toBeNull();
    expect(mapFrameUrl(42)).toBeNull();
    expect(consentFrameUrl({ kind: "map", query: "Austin" })).toBe(
      "https://maps.google.com/maps?q=Austin&output=embed",
    );
    expect(mapPlaceUrl("1 Main St")).toBe(
      "https://www.google.com/maps/search/?api=1&query=1%20Main%20St",
    );
  });

  it("every non-null URL's host is a consent frame host", () => {
    const urls = [
      consentFrameUrl({ kind: "link", provider: "youtube", id: YT }),
      consentFrameUrl({ kind: "link", provider: "vimeo", id: "76979871" }),
      consentFrameUrl({
        kind: "link",
        provider: "spotify",
        id: "track/4uLU6hMCjMI75M1A2tKUQC",
      }),
      consentFrameUrl({ kind: "link", provider: "calendly", id: "acme/intro" }),
      mapFrameUrl("Austin"),
      mapFrameUrl("Austin", "AIzaSyA-valid_key_1234567890"),
    ].filter((u): u is string => u !== null);
    expect(urls.length).toBeGreaterThanOrEqual(5);
    for (const u of urls) {
      expect(CONSENT_FRAME_HOSTS).toContain(new URL(u).hostname);
    }
  });
});

describe("parseConsentChoice", () => {
  it("accepts exact values only", () => {
    expect(parseConsentChoice("all")).toBe("all");
    expect(parseConsentChoice("necessary")).toBe("necessary");
    for (const v of ["ALL", " all", "", "yes", undefined, null, 1]) {
      expect(parseConsentChoice(v)).toBeNull();
    }
  });
});

const needs = (
  frames: ConsentNeeds["frames"],
  analytics = false,
): ConsentNeeds => ({
  needed: frames.length > 0 || analytics,
  frames,
  analytics,
});

describe("cookieText", () => {
  it("lists what the site uses", () => {
    expect(
      cookieText(
        needs([
          { kind: "video", provider: "youtube" },
          { kind: "map", provider: "google-maps" },
        ]),
      ),
    ).toBe(
      "This site uses cookies for embedded videos and maps from other companies. Choose what to allow.",
    );
    expect(
      cookieText(
        needs([
          { kind: "video", provider: "youtube" },
          { kind: "video", provider: "vimeo" },
          { kind: "audio", provider: "spotify" },
          { kind: "map", provider: "google-maps" },
        ]),
      ),
    ).toBe(
      "This site uses cookies for embedded videos, audio players and maps from other companies. Choose what to allow.",
    );
  });

  it("covers analytics alone and with frames", () => {
    expect(cookieText(needs([], true))).toBe(
      "This site uses cookies for visitor statistics from other companies. Choose what to allow.",
    );
    expect(
      cookieText(needs([{ kind: "video", provider: "youtube" }], true)),
    ).toBe(
      "This site uses cookies for embedded videos, and for visitor statistics, from other companies. Choose what to allow.",
    );
    expect(cookieText(needs([]))).toBe("");
  });
});

describe("consentStatusText", () => {
  it("names what triggers the notice", () => {
    expect(
      consentStatusText(
        needs([
          { kind: "video", provider: "youtube" },
          { kind: "map", provider: "google-maps" },
        ]),
      ),
    ).toBe(
      "Your site shows a cookie notice because it has a YouTube video and a map.",
    );
    expect(
      consentStatusText(needs([{ kind: "video", provider: "instagram" }])),
    ).toBe(
      "Your site shows a cookie notice because it has an Instagram video.",
    );
    expect(
      consentStatusText(
        needs([
          { kind: "video", provider: "youtube" },
          { kind: "video", provider: "vimeo" },
          { kind: "audio", provider: "spotify" },
          { kind: "map", provider: "google-maps" },
        ]),
      ),
    ).toBe(
      "Your site shows a cookie notice because it has a YouTube video, a Vimeo video, a Spotify audio player and more.",
    );
  });

  it("says when no notice is needed", () => {
    expect(consentStatusText(needs([]))).toBe(
      "No cookie notice needed: your site doesn't load anything from other companies.",
    );
  });

  it("consent lines", () => {
    expect(consentLine("video", "YouTube")).toBe(
      "Plays from YouTube, which may set cookies.",
    );
    expect(consentLine("map", "Google Maps")).toBe(
      "Loads Google Maps, which may set cookies.",
    );
  });
});
