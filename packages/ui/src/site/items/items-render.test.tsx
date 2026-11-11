// P7 site items (07-08; CONT-34, T-07-08-05, T-07-08-06): image library assets render from
// the media map by own-property lookup; video, audio, embed and form render through the
// dispatch without leaking a provider host into server HTML.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PROVIDER_FRAME_HOSTS, type ColumnItem } from "@cds/core/content";
import { ColumnItemRenderer } from "../ColumnItemRenderer";
import type { ResolvedMedia } from "../types";
import { thirdPartyLoads } from "../../test-support/consent-scan";
import { mediaSrc, mediaSrcSet, resolveMedia } from "./media";

const NOW = new Date("2026-10-01T12:00:00.000Z");

const A1: ResolvedMedia = {
  id: "a1",
  kind: "image",
  src: "/_media/a1/w960",
  srcSet: "/_media/a1/w480 480w, /_media/a1/w960 960w",
  width: 960,
  height: 640,
  alt: "Library alt",
};
const MEDIA: Readonly<Record<string, ResolvedMedia>> = {
  a1: A1,
  v1: { id: "v1", kind: "video", src: "/_media/v1/mp4", alt: "" },
  m1: { id: "m1", kind: "audio", src: "/_media/m1/mp3", alt: "" },
};

const render = (
  item: ColumnItem,
  media: Readonly<Record<string, ResolvedMedia>> | undefined = MEDIA,
) =>
  renderToStaticMarkup(
    <ColumnItemRenderer
      item={item}
      now={NOW}
      media={media}
      forms={{ form1: { name: "Contact" } }}
    />,
  );

describe("image item with a library asset", () => {
  it("renders src, srcset, sizes, width, height and the item alt", () => {
    const out = render({
      id: "i",
      kind: "image",
      url: "",
      alt: "Our studio",
      asset: "a1",
    });
    expect(out).toContain('src="/_media/a1/w960"');
    expect(out).toContain(
      'srcSet="/_media/a1/w480 480w, /_media/a1/w960 960w"',
    );
    expect(out).toContain('sizes="(min-width: 768px) 50vw, 100vw"');
    expect(out).toContain('width="960"');
    expect(out).toContain('height="640"');
    expect(out).toContain('alt="Our studio"');
  });

  it("falls back to the library alt when the item alt is blank", () => {
    expect(
      render({ id: "i", kind: "image", url: "", alt: "", asset: "a1" }),
    ).toContain('alt="Library alt"');
  });

  it("a missing asset falls back to the url, else nothing", () => {
    expect(
      render({
        id: "i",
        kind: "image",
        url: "https://x.test/a.jpg",
        alt: "A",
        asset: "gone",
      }),
    ).toContain('src="https://x.test/a.jpg"');
    expect(
      render({ id: "i", kind: "image", url: "", alt: "A", asset: "gone" }),
    ).toBe("");
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "asset %s renders nothing (own-property lookup)",
    (asset) => {
      expect(render({ id: "i", kind: "image", url: "", alt: "A", asset })).toBe(
        "",
      );
    },
  );

  it("an asset of another kind is not used as an image", () => {
    expect(
      render({ id: "i", kind: "image", url: "", alt: "A", asset: "v1" }),
    ).toBe("");
  });

  it.each(["javascript:alert(1)", "//evil.net/x", "https://evil.net\\x"])(
    "a media src of %s is refused",
    (src) => {
      const out = render(
        { id: "i", kind: "image", url: "", alt: "A", asset: "a1" },
        { a1: { ...A1, src } },
      );
      expect(out).toBe("");
    },
  );

  it("a srcSet with any bad candidate is dropped", () => {
    const out = render(
      { id: "i", kind: "image", url: "", alt: "A", asset: "a1" },
      {
        a1: {
          ...A1,
          srcSet: "/_media/a1/w480 480w, javascript:alert(1) 960w",
        },
      },
    );
    expect(out).toContain('src="/_media/a1/w960"');
    expect(out).not.toMatch(/srcSet|sizes|javascript/i);
  });
});

describe("media helpers", () => {
  it("resolveMedia is own-property and kind aware", () => {
    expect(resolveMedia(MEDIA, "a1")).toBe(A1);
    expect(resolveMedia(MEDIA, "a1", "video")).toBeNull();
    expect(resolveMedia(MEDIA, "__proto__")).toBeNull();
    expect(resolveMedia(undefined, "a1")).toBeNull();
    expect(resolveMedia(MEDIA, 5)).toBeNull();
  });

  it("mediaSrc accepts same-origin paths and https only", () => {
    expect(mediaSrc("/_media/a/w480")).toBe("/_media/a/w480");
    expect(mediaSrc("https://cdn.test/a.jpg")).toBe("https://cdn.test/a.jpg");
    for (const bad of [
      "http://cdn.test/a.jpg",
      "//evil.net/x",
      "/\\evil.net",
      "javascript:alert(1)",
      "data:image/png;base64,x",
      "https://u:p@cdn.test/a",
      "/a b",
      "/a\u0000b",
      5,
      "",
    ]) {
      expect(mediaSrc(bad), String(bad)).toBe("");
    }
  });

  it("mediaSrcSet keeps only fully valid sets", () => {
    expect(mediaSrcSet("/a 480w, /b 960w")).toBe("/a 480w, /b 960w");
    expect(mediaSrcSet("/a 1x, /b 2x")).toBe("/a 1x, /b 2x");
    expect(mediaSrcSet("/a 480w, //evil/b 960w")).toBe("");
    expect(mediaSrcSet("/a evil")).toBe("");
    expect(mediaSrcSet(undefined)).toBe("");
  });
});

describe("P7 kinds render through the dispatch without provider hosts (CONT-34)", () => {
  const YT = "dQw4w9WgXcQ";
  const items: ColumnItem[] = [
    {
      id: "v",
      kind: "video",
      title: "Tour",
      source: "link",
      asset: "",
      provider: "youtube",
      provider_id: YT,
      cover: "",
      shape: "16:9",
      controls: true,
      loop: false,
      autoplay: false,
    },
    {
      id: "v2",
      kind: "video",
      title: "Upload",
      source: "media",
      asset: "v1",
      provider: "",
      provider_id: "",
      cover: "",
      shape: "9:16",
      controls: true,
      loop: true,
      autoplay: true,
    },
    {
      id: "a",
      kind: "audio",
      title: "Ep",
      source: "link",
      asset: "",
      provider: "spotify",
      provider_id: "track/4uLU6hMCjMI75M1A2tKUQC",
    },
    {
      id: "a2",
      kind: "audio",
      title: "Ep",
      source: "media",
      asset: "m1",
      provider: "",
      provider_id: "",
    },
    {
      id: "e",
      kind: "embed",
      title: "Book",
      provider: "calendly",
      provider_id: "acme",
    },
    { id: "f", kind: "form", form_id: "form1" },
  ];

  // 07-23: the placeholders now render. A plain <a href> to the provider page (the no-JS
  // fallback) makes no request until clicked (07-14 choice 1), so the check is on loading
  // contexts through thirdPartyLoads, over every PROVIDER_FRAME_HOSTS host.
  it.each(items.map((i) => [i.kind, i] as const))(
    "%s renders without throwing and with no frame host loaded or iframe",
    (_kind, item) => {
      const out = render(item);
      expect(out).not.toMatch(/<iframe/i);
      expect(thirdPartyLoads(out, PROVIDER_FRAME_HOSTS)).toEqual([]);
    },
  );
});

describe("07-23 video, audio and booking calendar SSR (CONT-17, CONT-27, CONT-34)", () => {
  const YT = "dQw4w9WgXcQ";
  const V: ResolvedMedia = {
    id: "v9",
    kind: "video",
    src: "/_media/v9/video.mp4",
    poster: "/_media/v9/poster.webp",
    alt: "",
    mime: "video/mp4",
  };
  const COVER: ResolvedMedia = {
    id: "c9",
    kind: "image",
    src: "/_media/c9/w960",
    alt: "Our cover",
  };
  const vid = (over: Partial<Extract<ColumnItem, { kind: "video" }>> = {}) =>
    ({
      id: "v",
      kind: "video",
      title: "Spring tour",
      source: "media",
      asset: "v9",
      provider: "",
      provider_id: "",
      cover: "",
      shape: "16:9",
      controls: true,
      loop: false,
      autoplay: false,
      ...over,
    }) as ColumnItem;

  it("an MP4 renders one video with controls, preload none, playsinline, our poster and the pop-up hook", () => {
    const out = render(vid({ autoplay: true }), { v9: V });
    expect(out.match(/<video/g)).toHaveLength(1);
    expect(out).toMatch(/<video[^>]*\scontrols=""/);
    expect(out).toContain('preload="none"');
    expect(out).toContain('playsInline=""');
    expect(out).toContain('poster="/_media/v9/poster.webp"');
    expect(out).toContain('data-cds-popup-play=""');
    expect(out).toContain('aria-label="Spring tour"');
    expect(out).not.toMatch(/\sautoplay/i);
    expect(out).toContain("aspect-ratio:16 / 9");
    expect(out).not.toContain("<track");
    expect(out).not.toContain("crossorigin");
    expect(thirdPartyLoads(out)).toEqual([]);
  });

  it.each([
    ["9:16", "9 / 16"],
    ["1:1", "1 / 1"],
  ] as const)("shape %s sets the aspect ratio", (shape, ratio) => {
    expect(render(vid({ shape }), { v9: V })).toContain(
      `aspect-ratio:${ratio}`,
    );
  });

  it("captions add a default captions track; crossorigin only for an absolute src", () => {
    const local = render(vid(), {
      v9: { ...V, captions: "/_media/v9/captions.vtt" },
    });
    expect(local).toMatch(
      /<track kind="captions" src="\/_media\/v9\/captions.vtt" label="Captions" default=""/,
    );
    expect(local).not.toContain("crossorigin");
    const cdn = render(vid(), {
      v9: {
        ...V,
        src: "https://cdn.example.net/v9/video.mp4",
        captions: "https://cdn.example.net/v9/captions.vtt",
      },
    });
    expect(cdn).toContain('crossorigin="anonymous"');
  });

  it("the item cover replaces the generated poster", () => {
    expect(render(vid({ cover: "c9" }), { v9: V, c9: COVER })).toContain(
      'poster="/_media/c9/w960"',
    );
  });

  it("paused delivery renders the poster as an image, no video", () => {
    const out = render(vid(), { v9: { ...V, src: "" } });
    expect(out).not.toContain("<video");
    expect(out).toContain('role="img"');
    expect(out).toContain('src="/_media/v9/poster.webp"');
  });

  it("a processing (absent) video renders nothing", () => {
    expect(render(vid(), {})).toBe("");
  });

  it("link video, link audio and booking calendar render the consent placeholder only", () => {
    const cases: ColumnItem[] = [
      vid({
        source: "link",
        asset: "",
        provider: "youtube",
        provider_id: YT,
        cover: "c9",
      }),
      vid({
        source: "link",
        asset: "",
        provider: "vimeo",
        provider_id: "76979871",
      }),
      {
        id: "a",
        kind: "audio",
        title: "Episode",
        source: "link",
        asset: "",
        provider: "spotify",
        provider_id: "track/4uLU6hMCjMI75M1A2tKUQC",
      },
      {
        id: "e",
        kind: "embed",
        title: "Book a call",
        provider: "calendly",
        provider_id: "acme",
      },
    ];
    for (const item of cases) {
      const out = render(item, { c9: COVER });
      expect(out).not.toMatch(/<iframe/i);
      expect(out).not.toContain("<video");
      expect(out.length).toBeGreaterThan(0);
      expect(thirdPartyLoads(out)).toEqual([]);
    }
    const yt = render(cases[0]!, { c9: COVER });
    expect(yt).toContain("/_media/c9/w960");
    expect(yt).not.toContain("i.ytimg.com");
  });

  it("an MP3 renders the title above a native player labelled by it", () => {
    const out = render(
      {
        id: "a7",
        kind: "audio",
        title: "Episode 4",
        source: "media",
        asset: "m1",
        provider: "",
        provider_id: "",
      },
      MEDIA,
    );
    expect(out).toContain('<p id="audio-a7"');
    expect(out).toContain("Episode 4");
    expect(out).toMatch(/<audio[^>]*controls=""/);
    expect(out).toContain('preload="none"');
    expect(out).toContain('aria-labelledby="audio-a7"');
    expect(out.indexOf("Episode 4")).toBeLessThan(out.indexOf("<audio"));
  });

  it("titles render as text", () => {
    const out = render(vid({ title: "<img src=x onerror=alert(1)>" }), {
      v9: V,
    });
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("items with nothing to show render nothing", () => {
    expect(
      render(
        vid({ source: "link", provider: "youtube", provider_id: "bad" }),
        {},
      ),
    ).toBe("");
    expect(
      render(
        {
          id: "a",
          kind: "audio",
          title: "x",
          source: "media",
          asset: "gone",
          provider: "",
          provider_id: "",
        },
        {},
      ),
    ).toBe("");
    expect(
      render({
        id: "e",
        kind: "embed",
        title: "x",
        provider: "youtube" as never,
        provider_id: YT,
      }),
    ).toBe("");
  });
});
