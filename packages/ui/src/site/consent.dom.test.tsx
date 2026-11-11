// @vitest-environment jsdom
// 07-14: one consent rule (CONT-34, D279; D-UI-P7-17, D-UI-P7-18; RESEARCH Pitfall 7).
// Frame half: SSR scan of every frame kind, then the click-to-load island in jsdom.
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentFrame, type ConsentFrameProps } from "./ConsentFrame";
import { ConsentFrameIsland } from "./client/ConsentFrameIsland";
import { VideoItem } from "./items/VideoItem";
import type { VideoColumnItem } from "@cds/core/content";
import {
  ConsentController,
  CookieChoicesLink,
} from "./client/ConsentController";
import {
  CONSENT_EVENT,
  consentPending,
  onConsentResolved,
  readConsent,
  writeConsent,
} from "./client/consent-state";
import { siteButtonClasses } from "./SiteButton";
import type { ResolvedMedia } from "./types";
import { thirdPartyLoads } from "../test-support/consent-scan";
import { button, click, flush, mount, type Mounted } from "../test-support/dom";

const YT = "dQw4w9WgXcQ";
const SPOTIFY = "track/4uLU6hMCjMI75M1A2tKUQC";

const cover: ResolvedMedia = {
  id: "img1",
  kind: "image",
  src: "/_media/org1/image/img1/w960.webp",
  alt: "Chef plating the spring menu",
};

const youtube: ConsentFrameProps = {
  source: { kind: "link", provider: "youtube", id: YT },
  kind: "video",
  title: "Spring menu tour",
  cover,
};
const vimeo: ConsentFrameProps = {
  source: { kind: "link", provider: "vimeo", id: "76979871" },
  kind: "video",
  title: "Studio tour",
  aspect: "9:16",
};
const spotify: ConsentFrameProps = {
  source: { kind: "link", provider: "spotify", id: SPOTIFY },
  kind: "audio",
  title: "Episode 1",
};
const calendly: ConsentFrameProps = {
  source: { kind: "link", provider: "calendly", id: "acme-studio" },
  kind: "booking",
  title: "Book a consult",
};
const map: ConsentFrameProps = {
  source: { kind: "map", query: "1 Main St, Austin" },
  kind: "map",
  title: "Our studio",
  address: "1 Main St, Austin",
};

const ssr = (p: ConsentFrameProps) =>
  renderToStaticMarkup(<ConsentFrame {...p} />);

describe("thirdPartyLoads", () => {
  it("reports frame hosts in loading contexts only", () => {
    expect(
      thirdPartyLoads(
        `<iframe src="https://www.youtube-nocookie.com/embed/${YT}"></iframe>`,
      ),
    ).toEqual(["www.youtube-nocookie.com"]);
    expect(
      thirdPartyLoads(`<img src="https://i.ytimg.com/vi/${YT}/hqdefault.jpg">`),
    ).toEqual(["i.ytimg.com"]);
    expect(
      thirdPartyLoads(
        '<link rel="preconnect" href="https://player.vimeo.com">',
      ),
    ).toEqual(["player.vimeo.com"]);
    expect(
      thirdPartyLoads(
        '<div style="background:url(https://open.spotify.com/x)"></div>',
      ),
    ).toEqual(["open.spotify.com"]);
    expect(
      thirdPartyLoads(
        '<img srcset="/a.webp 1x, https://i.ytimg.com/vi/x/max.jpg 2x">',
      ),
    ).toEqual(["i.ytimg.com"]);
    expect(
      thirdPartyLoads(
        '<meta http-equiv="refresh" content="0;url=https://calendly.com/x">',
      ),
    ).toEqual(["calendly.com"]);
  });

  it("ignores plain links and prose", () => {
    expect(
      thirdPartyLoads(
        `<a href="https://www.youtube.com/watch?v=${YT}">YouTube</a>` +
          "<p>We embed from www.youtube-nocookie.com and calendly.com</p>" +
          '<a href="https://calendly.com/acme">Book</a>',
      ),
    ).toEqual([]);
  });
});

describe("ConsentFrame SSR", () => {
  it("never loads anything from a provider, for every frame kind", () => {
    for (const p of [youtube, vimeo, spotify, calendly, map]) {
      const html = ssr(p);
      expect(html, p.title).not.toBe("");
      expect(thirdPartyLoads(html), p.title).toEqual([]);
      expect(html, p.title).not.toContain("<iframe");
      expect(html, p.title).not.toContain("youtube-nocookie");
      expect(html, p.title).not.toContain("player.vimeo.com");
    }
  });

  it("video: final aspect ratio, our cover, provider page link", () => {
    const html = ssr(youtube);
    expect(html).toContain("aspect-ratio:16 / 9");
    expect(html).toContain(`src="${cover.src}"`);
    expect(html).toContain(`alt="${cover.alt}"`);
    expect(html).toContain(`href="https://www.youtube.com/watch?v=${YT}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(
      'aria-label="Play video: Spring menu tour, opens YouTube in a new tab"',
    );
    expect(html).toContain("Plays from YouTube, which may set cookies.");
    expect(ssr(vimeo)).toContain("aspect-ratio:9 / 16");
    expect(ssr(vimeo)).not.toContain("<img");
    expect(ssr({ ...vimeo, aspect: "1:1" })).toContain("aspect-ratio:1 / 1");
  });

  it("audio, booking and map: copy and final size", () => {
    const audio = ssr(spotify);
    expect(audio).toContain("Play from Spotify");
    expect(audio).toContain("Loads Spotify, which may set cookies.");
    expect(audio).toContain("height:152px");
    const booking = ssr(calendly);
    expect(booking).toContain("Show booking calendar");
    expect(booking).toContain("Loads Calendly, which may set cookies.");
    expect(booking).toContain("height:704px");
    const m = ssr(map);
    expect(m).toContain("1 Main St, Austin");
    expect(m).toContain("Show map");
    expect(m).toContain("Loads Google Maps, which may set cookies.");
    expect(m).toContain("h-[320px]");
    expect(m).toContain("md:h-[400px]");
    expect(m).toContain(
      'href="https://www.google.com/maps/search/?api=1&amp;query=1%20Main%20St%2C%20Austin"',
    );
  });

  it("a blank title falls back to the provider and kind name (WR-D02)", () => {
    expect(ssr({ ...youtube, title: "" })).toContain(
      "Play video: YouTube video, opens YouTube in a new tab",
    );
    expect(ssr({ ...youtube, title: "  " })).not.toContain("Play video: ,");
  });

  it("VideoItem: a blank title still names the player and the link frame (WR-D02)", () => {
    const NOW = new Date("2026-10-01T12:00:00.000Z");
    const media = {
      v1: {
        id: "v1",
        kind: "video" as const,
        src: "/_media/v1/video.mp4",
        poster: "/_media/v1/poster.webp",
        alt: "",
      },
    };
    const base: VideoColumnItem = {
      id: "v",
      kind: "video",
      title: "",
      source: "media",
      asset: "v1",
      provider: "",
      provider_id: "",
      cover: "",
      shape: "16:9",
      controls: true,
      loop: false,
      autoplay: false,
    };
    const mp4 = renderToStaticMarkup(
      <VideoItem now={NOW} media={media} item={base} />,
    );
    expect(mp4).toContain('aria-label="Video"');
    const link = renderToStaticMarkup(
      <VideoItem
        now={NOW}
        media={media}
        item={{
          ...base,
          source: "link",
          asset: "",
          provider: "youtube",
          provider_id: YT,
        }}
      />,
    );
    expect(link).toContain("Play video: YouTube video");
  });

  it("renders nothing for an invalid source; drops an unsafe cover", () => {
    expect(
      ssr({ ...youtube, source: { kind: "link", provider: "evil", id: YT } }),
    ).toBe("");
    expect(
      ssr({
        ...youtube,
        source: { kind: "link", provider: "__proto__", id: YT },
      }),
    ).toBe("");
    expect(
      ssr({ ...spotify, kind: "video" }), // wrong category
    ).toBe("");
    expect(ssr({ ...map, source: { kind: "map", query: "" } })).toBe("");
    expect(
      ssr({ ...youtube, cover: { ...cover, src: "javascript:alert(1)" } }),
    ).not.toContain("<img");
  });
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  document.cookie = "cds_consent=; Max-Age=0; Path=/";
});

const islandProps = (title: string, id = YT) => ({
  source: { kind: "link", provider: "youtube", id } as const,
  kind: "video" as const,
  title,
  providerLabel: "YouTube",
  fallbackHref: `https://www.youtube.com/watch?v=${id}`,
  line: "Plays from YouTube, which may set cookies.",
});

describe("ConsentFrameIsland", () => {
  it("swaps the link for a button and loads that frame only on click", async () => {
    mounted = mount(
      <>
        <ConsentFrameIsland {...islandProps("Spring menu tour")} />
        <ConsentFrameIsland {...islandProps("Second video", "aaaaaaaaaaa")} />
      </>,
    );
    await flush();
    const { container } = mounted;
    expect(container.querySelector("a[target=_blank]")).toBeNull();
    const play = button(
      container,
      "Play video: Spring menu tour, from YouTube",
    );
    expect(play).not.toBeNull();
    click(play);
    await flush();
    const frames = container.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    const f = frames[0] as HTMLIFrameElement;
    expect(f.getAttribute("src")).toBe(
      `https://www.youtube-nocookie.com/embed/${YT}`,
    );
    expect(f.getAttribute("title")).toBe("Spring menu tour");
    expect(f.getAttribute("loading")).toBe("lazy");
    expect(f.getAttribute("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(f.getAttribute("allow")).toBe(
      "autoplay; encrypted-media; picture-in-picture; fullscreen",
    );
    expect(f.hasAttribute("allowfullscreen")).toBe(true);
    expect(document.activeElement).toBe(f);
    // D-UI-P7-17: the other frame stays a placeholder.
    expect(
      button(container, "Play video: Second video, from YouTube"),
    ).not.toBeNull();
  });

  it("Accept all loads every frame without moving focus; Only necessary loads none", async () => {
    mounted = mount(
      <>
        <ConsentFrameIsland {...islandProps("One")} />
        <ConsentFrameIsland {...islandProps("Two", "aaaaaaaaaaa")} />
      </>,
    );
    await flush();
    const before = document.activeElement;
    act(() => {
      document.dispatchEvent(
        new CustomEvent(CONSENT_EVENT, { detail: { choice: "necessary" } }),
      );
    });
    await flush();
    expect(mounted.container.querySelectorAll("iframe")).toHaveLength(0);
    act(() => {
      document.dispatchEvent(
        new CustomEvent(CONSENT_EVENT, { detail: { choice: "all" } }),
      );
    });
    await flush();
    expect(mounted.container.querySelectorAll("iframe")).toHaveLength(2);
    expect(document.activeElement).toBe(before);
  });

  it("withdrawing consent unloads consent-loaded frames and keeps clicked ones (WR-D01)", async () => {
    mounted = mount(
      <>
        <ConsentFrameIsland {...islandProps("One")} />
        <ConsentFrameIsland {...islandProps("Two", "aaaaaaaaaaa")} />
      </>,
    );
    await flush();
    click(button(mounted.container, "Play video: One, from YouTube"));
    await flush();
    const send = (choice: string) =>
      act(() => {
        document.dispatchEvent(
          new CustomEvent(CONSENT_EVENT, { detail: { choice } }),
        );
      });
    send("all");
    await flush();
    expect(mounted.container.querySelectorAll("iframe")).toHaveLength(2);
    send("necessary");
    await flush();
    const left = mounted.container.querySelectorAll("iframe");
    expect(left).toHaveLength(1);
    expect(left[0]!.getAttribute("title")).toBe("One");
  });

  it("a stored cds_consent=all frame unloads when consent is withdrawn (WR-D01)", async () => {
    document.cookie = "cds_consent=all; Path=/";
    mounted = mount(<ConsentFrameIsland {...islandProps("One")} />);
    await flush();
    expect(mounted.container.querySelectorAll("iframe")).toHaveLength(1);
    act(() => {
      document.dispatchEvent(
        new CustomEvent(CONSENT_EVENT, { detail: { choice: "necessary" } }),
      );
    });
    await flush();
    expect(mounted.container.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("a stored cds_consent=all loads frames on mount", async () => {
    document.cookie = "cds_consent=all; Path=/";
    mounted = mount(<ConsentFrameIsland {...islandProps("One")} />);
    await flush();
    expect(mounted.container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("a malformed stored value loads nothing", async () => {
    document.cookie = "cds_consent=ALL; Path=/";
    mounted = mount(<ConsentFrameIsland {...islandProps("One")} />);
    await flush();
    expect(mounted.container.querySelectorAll("iframe")).toHaveLength(0);
  });
});

// ---- banner half (Task 2) -------------------------------------------------------------------

const TEXT =
  "This site uses cookies for embedded videos and maps from other companies. Choose what to allow.";

describe("consent-state", () => {
  it("reads the choice from a cookie string, exact values only", () => {
    expect(readConsent("a=1; cds_consent=all")).toBe("all");
    expect(readConsent("cds_consent=necessary")).toBe("necessary");
    expect(readConsent("cds_consent=ALL")).toBeNull();
    expect(readConsent("xcds_consent=all")).toBeNull();
    expect(readConsent("")).toBeNull();
  });

  it("writes a 180-day first-party cookie, Secure only on https", () => {
    const fake = (protocol: string) =>
      ({
        cookie: "",
        defaultView: { location: { protocol } },
      }) as unknown as Document;
    const http = fake("http:");
    writeConsent("necessary", http);
    expect(http.cookie).toBe(
      "cds_consent=necessary; Path=/; Max-Age=15552000; SameSite=Lax",
    );
    const https = fake("https:");
    writeConsent("all", https);
    expect(https.cookie).toBe(
      "cds_consent=all; Path=/; Max-Age=15552000; SameSite=Lax; Secure",
    );
  });

  it("pending needs the marker and no cookie", () => {
    expect(consentPending(document)).toBe(false);
    const marker = document.createElement("div");
    marker.setAttribute("data-cds-consent-pending", "");
    document.body.appendChild(marker);
    expect(consentPending(document)).toBe(true);
    document.cookie = "cds_consent=necessary; Path=/";
    expect(consentPending(document)).toBe(false);
  });

  it("onConsentResolved runs next tick when not pending, once after the event when pending", async () => {
    const now = vi.fn();
    onConsentResolved(now);
    expect(now).not.toHaveBeenCalled();
    await flush(1);
    expect(now).toHaveBeenCalledTimes(1);

    const marker = document.createElement("div");
    marker.setAttribute("data-cds-consent-pending", "");
    document.body.appendChild(marker);
    const later = vi.fn();
    onConsentResolved(later);
    await flush(1);
    expect(later).not.toHaveBeenCalled();
    const all = () =>
      document.dispatchEvent(
        new CustomEvent(CONSENT_EVENT, { detail: { choice: "all" } }),
      );
    all();
    all();
    expect(later).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    const off = onConsentResolved(cancelled);
    off();
    all();
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe("ConsentController SSR", () => {
  it("renders an equal-choice region with the pending marker", () => {
    const html = renderToStaticMarkup(
      <ConsentController text={TEXT} initialChoice={null} />,
    );
    expect(html).toMatch(/<section[^>]*role="region"/);
    expect(html).toContain('aria-label="Cookie choices"');
    expect(html).toContain("data-cds-consent-pending");
    expect(html).toContain(TEXT);
    expect(html).not.toContain("Privacy");
    expect(html).not.toMatch(/<section[^>]*hidden/);
    const classes = [
      ...html.matchAll(
        /<button[^>]*class="([^"]*)"[^>]*>(Accept all|Only necessary)</g,
      ),
    ];
    expect(classes.map((m) => m[2])).toEqual(["Accept all", "Only necessary"]);
    expect(classes[0]![1]).toBe(classes[1]![1]);
    expect(classes[0]![1]).toContain(siteButtonClasses("secondary"));
    expect(html).not.toContain("bg-site-primary");
    expect(html).not.toContain('role="dialog"');
  });

  it("links Privacy only when given; hidden with no marker when a choice exists", () => {
    expect(
      renderToStaticMarkup(
        <ConsentController
          text={TEXT}
          privacyHref="/privacy"
          initialChoice={null}
        />,
      ),
    ).toContain('href="/privacy"');
    const chosen = renderToStaticMarkup(
      <ConsentController text={TEXT} initialChoice="all" />,
    );
    expect(chosen).toMatch(/<section[^>]*hidden/);
    expect(chosen).not.toContain("data-cds-consent-pending");
  });
});

describe("ConsentController in the browser", () => {
  function page(): HTMLElement {
    const main = document.createElement("main");
    main.id = "content";
    main.innerHTML = '<a href="/x">x</a>';
    document.body.appendChild(main);
    return main;
  }
  const banner = () =>
    document.querySelector<HTMLElement>('section[aria-label="Cookie choices"]');
  const wait = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });

  it("Accept all writes the cookie, announces once, fades out and moves focus to main", async () => {
    const main = page();
    const seen: unknown[] = [];
    const onConsent = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener(CONSENT_EVENT, onConsent);
    mounted = mount(<ConsentController text={TEXT} initialChoice={null} />);
    await flush();
    const accept = button(document.body, "Accept all")!;
    accept.focus();
    click(accept);
    expect(readConsent(document.cookie)).toBe("all");
    expect(banner()!.hasAttribute("data-cds-consent-pending")).toBe(false);
    expect(banner()!.className).toContain("opacity-0");
    expect(banner()!.hidden).toBe(false);
    await wait(250);
    expect(banner()!.hidden).toBe(true);
    expect(seen).toEqual([{ choice: "all" }]);
    expect(document.activeElement).toBe(main);
    document.removeEventListener(CONSENT_EVENT, onConsent);
  });

  it("leaves focus alone when it was not in the banner; instant under reduced motion", async () => {
    page();
    const other = document.createElement("button");
    document.body.appendChild(other);
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    try {
      mounted = mount(<ConsentController text={TEXT} initialChoice={null} />);
      await flush();
      other.focus();
      click(button(document.body, "Only necessary"));
      expect(banner()!.hidden).toBe(true);
      expect(readConsent(document.cookie)).toBe("necessary");
      expect(document.activeElement).toBe(other);
    } finally {
      window.matchMedia = mm;
    }
  });

  it("reopens from the Cookie choices link and a new choice overwrites the cookie", async () => {
    page();
    document.cookie = "cds_consent=all; Path=/";
    mounted = mount(
      <>
        <CookieChoicesLink />
        <ConsentController text={TEXT} initialChoice="all" />
      </>,
    );
    await flush();
    expect(banner()!.hidden).toBe(true);
    click(button(document.body, "Cookie choices"));
    expect(banner()!.hidden).toBe(false);
    expect(banner()!.hasAttribute("data-cds-consent-pending")).toBe(false);
    click(button(document.body, "Only necessary"));
    await wait(250);
    expect(readConsent(document.cookie)).toBe("necessary");
    expect(banner()!.hidden).toBe(true);
  });

  it("pads main by the banner height while shown and restores it", async () => {
    const main = page();
    const observed: Element[] = [];
    const RO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    const desc = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).hasAttribute("data-cds-consent-banner")
          ? 120
          : 0;
      },
    });
    try {
      mounted = mount(<ConsentController text={TEXT} initialChoice={null} />);
      await flush();
      expect(main.style.paddingBottom).toBe("120px");
      expect(observed).toEqual([banner()]);
      click(button(document.body, "Accept all"));
      await wait(250);
      expect(main.style.paddingBottom).toBe("");
    } finally {
      globalThis.ResizeObserver = RO;
      if (desc) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", desc);
      }
    }
  });
});
