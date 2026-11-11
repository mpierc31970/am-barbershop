// parseMediaLink: the one link parser (CONT-17, CONT-27, CONT-34, D219, D279, D281).
// Driven from the corpus in __fixtures__/media-links.ts.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  HOSTILE_LINKS,
  IFRAME_PASTES,
  VALID_LINKS,
} from "./__fixtures__/media-links";
import {
  AUDIO_LINK_EMPTY_COPY,
  AUDIO_NOT_ALLOWED_COPY,
  AUDIO_PROVIDERS,
  EMBED_LINK_EMPTY_COPY,
  EMBED_NOT_ALLOWED_COPY,
  EMBED_PROVIDERS,
  LINK_NOT_ALLOWED_COPY,
  PROVIDER_FRAME_HOSTS,
  PROVIDER_LABELS,
  VIDEO_LINK_EMPTY_COPY,
  VIDEO_PROVIDERS,
  mediaLinkFrom,
  parseMediaLink,
  parseMediaLinkFor,
} from "./media-link";

function ok(input: unknown) {
  const r = parseMediaLink(input);
  if (!r.ok) throw new Error(`refused ${String(input)}: ${r.reason}`);
  return r.link;
}

describe("parseMediaLink: valid corpus", () => {
  it.each(VALID_LINKS)("$provider: $input", (c) => {
    const link = ok(c.input);
    expect(link.provider).toBe(c.provider);
    expect(link.category).toBe(c.category);
    expect(link.id).toBe(c.id);
    expect(link.embedUrl).toBe(c.embedUrl);
  });

  it.each(VALID_LINKS)("built URL is https on a frame host: $input", (c) => {
    const url = new URL(ok(c.input).embedUrl);
    expect(url.protocol).toBe("https:");
    expect(PROVIDER_FRAME_HOSTS).toContain(url.hostname);
  });

  it.each(VALID_LINKS)("pageUrl parses back to the same link: $input", (c) => {
    const link = ok(c.input);
    const again = ok(link.pageUrl);
    expect(again.provider).toBe(link.provider);
    expect(again.id).toBe(link.id);
    expect(again.embedUrl).toBe(link.embedUrl);
  });

  it.each(VALID_LINKS)("mediaLinkFrom rebuilds it: $input", (c) => {
    const link = ok(c.input);
    expect(mediaLinkFrom(link.provider, link.id)).toEqual(link);
  });

  it("every YouTube form uses youtube-nocookie and a server-side-only thumbnail", () => {
    const yt = VALID_LINKS.filter((c) => c.provider === "youtube");
    expect(yt.length).toBeGreaterThanOrEqual(10);
    for (const c of yt) {
      const link = ok(c.input);
      expect(new URL(link.embedUrl).hostname).toBe("www.youtube-nocookie.com");
      expect(link.thumbnailUrl).toBe(
        `https://i.ytimg.com/vi/${c.id}/hqdefault.jpg`,
      );
    }
  });

  it("Vimeo always carries dnt=1", () => {
    for (const c of VALID_LINKS.filter((v) => v.provider === "vimeo")) {
      expect(new URL(ok(c.input).embedUrl).searchParams.get("dnt")).toBe("1");
    }
  });

  it("http input still builds an https URL", () => {
    const link = ok("http://youtu.be/dQw4w9WgXcQ");
    expect(link.embedUrl.startsWith("https://")).toBe(true);
  });

  it("only calendars carry a height", () => {
    expect(ok("https://calendly.com/acme").height).toBe(704);
    expect(
      ok("https://calendar.google.com/calendar/embed?src=a%40b.com").height,
    ).toBe(600);
    expect(ok("https://youtu.be/dQw4w9WgXcQ").height).toBeUndefined();
  });

  it("covers at least two input forms for every provider", () => {
    const all = [...VIDEO_PROVIDERS, ...AUDIO_PROVIDERS, ...EMBED_PROVIDERS];
    for (const p of all) {
      expect(
        VALID_LINKS.filter((c) => c.provider === p).length,
        p,
      ).toBeGreaterThanOrEqual(2);
      expect(PROVIDER_LABELS[p], p).toBeTruthy();
    }
  });
});

describe("parseMediaLink: pasted iframe code", () => {
  it.each(IFRAME_PASTES)("$url", ({ html, url }) => {
    const fromHtml = ok(html);
    const fromUrl = ok(url);
    expect(fromHtml).toEqual(fromUrl);
  });

  it("never keeps any of the pasted HTML", () => {
    for (const { html } of IFRAME_PASTES) {
      const link = ok(html);
      expect(JSON.stringify(link)).not.toMatch(
        /<|>|allowfullscreen|frameborder|title=/i,
      );
    }
  });
});

describe("parseMediaLink: hostile corpus", () => {
  it("has at least 25 hostile entries", () => {
    expect(HOSTILE_LINKS.length).toBeGreaterThanOrEqual(25);
  });

  it.each(HOSTILE_LINKS)("refuses: $why", ({ input }) => {
    expect(parseMediaLink(input).ok).toBe(false);
  });

  it("reports empty, not-a-link and not-allowed", () => {
    expect(parseMediaLink("  ")).toEqual({ ok: false, reason: "empty" });
    expect(parseMediaLink(42)).toEqual({ ok: false, reason: "not-a-link" });
    expect(parseMediaLink("https://example.com/x")).toEqual({
      ok: false,
      reason: "not-allowed",
    });
  });

  it("parses the whole corpus quickly (no catastrophic regex)", () => {
    const inputs = [
      ...VALID_LINKS.map((c) => c.input),
      ...IFRAME_PASTES.map((c) => c.html),
      ...HOSTILE_LINKS.map((c) => c.input),
      `<iframe src="${"a".repeat(4000)}`,
      `<iframe ${"src=".repeat(900)}`,
    ];
    for (const input of inputs) {
      const start = performance.now();
      parseMediaLink(input);
      expect(performance.now() - start).toBeLessThan(50);
    }
  });
});

describe("mediaLinkFrom", () => {
  it.each([
    ["unknown provider", "dailymotion", "x7tgad0"],
    ["prototype key", "__proto__", "dQw4w9WgXcQ"],
    ["constructor", "constructor", "dQw4w9WgXcQ"],
    ["toString", "toString", "dQw4w9WgXcQ"],
    ["bad YouTube id", "youtube", "bad"],
    ["YouTube id with slash", "youtube", "dQw4w9/gXcQ"],
    ["non-string id", "youtube", 12345678901],
    ["non-string provider", 1, "dQw4w9WgXcQ"],
    ["Spotify without type", "spotify", "4uLU6hMCjMI75M1A2tKUQC"],
    ["SoundCloud traversal", "soundcloud", "../evil"],
    ["Calendly empty", "calendly", ""],
  ])("returns null for %s", (_why, provider, id) => {
    expect(mediaLinkFrom(provider, id)).toBeNull();
  });
});

describe("parseMediaLinkFor", () => {
  it("returns the link when the category matches", () => {
    expect(parseMediaLinkFor("video", "https://youtu.be/dQw4w9WgXcQ").id).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it.each([
    [
      "video",
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      LINK_NOT_ALLOWED_COPY,
    ],
    ["video", "https://evil.net/x", LINK_NOT_ALLOWED_COPY],
    ["audio", "https://youtu.be/dQw4w9WgXcQ", AUDIO_NOT_ALLOWED_COPY],
    ["audio", "javascript:alert(1)", AUDIO_NOT_ALLOWED_COPY],
    ["embed", "https://youtu.be/dQw4w9WgXcQ", EMBED_NOT_ALLOWED_COPY],
    ["embed", "https://youtube.com.evil.net/x", EMBED_NOT_ALLOWED_COPY],
    ["video", "", VIDEO_LINK_EMPTY_COPY],
    ["audio", "  ", AUDIO_LINK_EMPTY_COPY],
    ["embed", "", EMBED_LINK_EMPTY_COPY],
  ] as const)("%s refuses %s", (category, input, copy) => {
    expect(() => parseMediaLinkFor(category, input)).toThrow(InvalidInput);
    expect(() => parseMediaLinkFor(category, input)).toThrow(copy);
  });

  it("uses the exact UI-SPEC copy", () => {
    expect(LINK_NOT_ALLOWED_COPY).toBe(
      "We can't show videos from this site. Use YouTube, Vimeo, Wistia, Loom, Facebook, Instagram, X or TikTok, or upload it as an MP4 instead.",
    );
    expect(AUDIO_NOT_ALLOWED_COPY).toBe(
      "We can't play audio from this site. Use Spotify, SoundCloud or Apple Podcasts, or upload an MP3 instead.",
    );
    expect(EMBED_NOT_ALLOWED_COPY).toBe(
      "This site isn't on the allowed list. You can add a Calendly or public Google Calendar link.",
    );
  });
});
