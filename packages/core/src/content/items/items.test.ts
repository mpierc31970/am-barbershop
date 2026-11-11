// P7 column item kinds (07-08; CONT-17, CONT-25, CONT-27, D281): validators through
// validateColumnItem, defaults, the image library asset and pop-up use.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { newColumnItem } from "../columns";
import {
  AUDIO_NOT_ALLOWED_COPY,
  EMBED_NOT_ALLOWED_COPY,
  LINK_NOT_ALLOWED_COPY,
} from "../media-link";
import { validatePopup } from "../popup-rules";
import { COLUMN_ITEM_KINDS } from "../types";
import { validateColumnItem } from "../validate";
import { ALT_COPY, MALFORMED_COPY } from "../validate-helpers";
import { AUDIO_SOURCE_COPY, AUDIO_TITLE_COPY } from "./audio";
import { EMBED_TITLE_COPY } from "./embed";
import { FORM_ITEM_COPY } from "./form";
import { VIDEO_SOURCE_COPY, VIDEO_TITLE_COPY } from "./video";

const opts = { allowPopupButton: true };
const v = (raw: Record<string, unknown>) => validateColumnItem(raw, opts);
const msg = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidInput);
    return (err as Error).message;
  }
  return "no error";
};

const YT = "dQw4w9WgXcQ";

function withoutId(item: object): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...item };
  delete copy.id;
  return copy;
}

describe("COLUMN_ITEM_KINDS", () => {
  it("ends with video, audio, form, embed after the existing kinds", () => {
    expect([...COLUMN_ITEM_KINDS]).toEqual([
      "heading",
      "text",
      "list",
      "image",
      "button",
      "spacer",
      "divider",
      "countdown",
      "video",
      "audio",
      "form",
      "embed",
    ]);
  });
});

describe("newColumnItem (P7 kinds)", () => {
  it("video, audio, form and embed defaults", () => {
    const video = withoutId(newColumnItem("video"));
    expect(video).toEqual({
      kind: "video",
      title: "",
      source: "media",
      asset: "",
      provider: "",
      provider_id: "",
      cover: "",
      shape: "16:9",
      controls: true,
      loop: false,
      autoplay: false,
    });
    const audio = withoutId(newColumnItem("audio"));
    expect(audio).toEqual({
      kind: "audio",
      title: "",
      source: "media",
      asset: "",
      provider: "",
      provider_id: "",
    });
    const form = withoutId(newColumnItem("form"));
    expect(form).toEqual({ kind: "form", form_id: "" });
    const embed = withoutId(newColumnItem("embed"));
    expect(embed).toEqual({
      kind: "embed",
      title: "",
      provider: "",
      provider_id: "",
    });
  });

  it("image has no asset key", () => {
    expect(Object.keys(newColumnItem("image")).sort()).toEqual([
      "alt",
      "id",
      "kind",
      "url",
    ]);
  });
});

describe("video item", () => {
  const base = { id: "v1", kind: "video", title: "Studio tour" };

  it("requires a title", () => {
    expect(msg(() => v({ ...base, title: "  ", asset: "a1" }))).toBe(
      VIDEO_TITLE_COPY,
    );
  });

  it("media source with an asset passes and clears provider fields", () => {
    expect(
      v({
        ...base,
        source: "media",
        asset: "a1",
        provider: "youtube",
        provider_id: YT,
        autoplay: true,
      }),
    ).toEqual({
      id: "v1",
      kind: "video",
      title: "Studio tour",
      source: "media",
      asset: "a1",
      provider: "",
      provider_id: "",
      cover: "",
      shape: "16:9",
      controls: true,
      loop: false,
      autoplay: true,
    });
  });

  it("media source without an asset or link throws the source copy", () => {
    expect(msg(() => v({ ...base, source: "media", asset: "" }))).toBe(
      VIDEO_SOURCE_COPY,
    );
    expect(msg(() => v({ ...base, source: "link" }))).toBe(VIDEO_SOURCE_COPY);
  });

  it("a pasted link is parsed and never stored; autoplay is forced off", () => {
    const out = v({
      ...base,
      link: `https://www.youtube.com/watch?v=${YT}&t=30s`,
      asset: "a1",
      autoplay: true,
      onclick: "x",
    });
    expect(out).toMatchObject({
      source: "link",
      provider: "youtube",
      provider_id: YT,
      asset: "",
      autoplay: false,
    });
    expect(out).not.toHaveProperty("link");
    expect(out).not.toHaveProperty("onclick");
  });

  it("a pasted iframe is accepted the same way", () => {
    expect(
      v({
        ...base,
        link: `<iframe src="https://player.vimeo.com/video/76979871"></iframe>`,
      }),
    ).toMatchObject({ provider: "vimeo", provider_id: "76979871" });
  });

  it("refuses other providers and bad stored ids with the video copy", () => {
    expect(
      msg(() =>
        v({
          ...base,
          link: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        }),
      ),
    ).toBe(LINK_NOT_ALLOWED_COPY);
    expect(
      msg(() =>
        v({ ...base, source: "link", provider: "youtube", provider_id: "bad" }),
      ),
    ).toBe(LINK_NOT_ALLOWED_COPY);
    expect(
      msg(() => v({ ...base, provider: "__proto__", provider_id: YT })),
    ).toBe(LINK_NOT_ALLOWED_COPY);
    expect(
      msg(() => v({ ...base, link: "https://youtube.com.evil.net/watch?v=x" })),
    ).toBe(LINK_NOT_ALLOWED_COPY);
  });

  it("a stored provider pair is accepted (re-validated)", () => {
    expect(
      v({ ...base, source: "link", provider: "youtube", provider_id: YT }),
    ).toMatchObject({ source: "link", provider: "youtube", provider_id: YT });
  });

  it("shape, controls and loop", () => {
    const out = v({
      ...base,
      asset: "a1",
      shape: "4:3",
      controls: 0,
      loop: "yes",
    });
    expect(out).toMatchObject({ shape: "16:9", controls: true, loop: false });
    expect(
      v({ ...base, asset: "a1", shape: "9:16", controls: false, loop: true }),
    ).toMatchObject({ shape: "9:16", controls: false, loop: true });
  });

  it.each(["../x", "a b", "x/y", 5])(
    "malformed asset or cover id %s throws",
    (bad) => {
      expect(msg(() => v({ ...base, asset: bad }))).toBe(MALFORMED_COPY);
      expect(msg(() => v({ ...base, asset: "a1", cover: bad }))).toBe(
        MALFORMED_COPY,
      );
    },
  );

  it("keeps a valid cover id", () => {
    expect(v({ ...base, asset: "a1", cover: "c1" })).toMatchObject({
      cover: "c1",
    });
  });
});

describe("audio item", () => {
  const base = { id: "a", kind: "audio", title: "Episode 4" };

  it("requires a title", () => {
    expect(msg(() => v({ ...base, title: "", asset: "m1" }))).toBe(
      AUDIO_TITLE_COPY,
    );
  });

  it("accepts an audio link and refuses a video link", () => {
    expect(
      v({
        ...base,
        link: "https://open.spotify.com/episode/4uLU6hMCjMI75M1A2tKUQC",
      }),
    ).toEqual({
      id: "a",
      kind: "audio",
      title: "Episode 4",
      source: "link",
      asset: "",
      provider: "spotify",
      provider_id: "episode/4uLU6hMCjMI75M1A2tKUQC",
    });
    expect(msg(() => v({ ...base, link: `https://youtu.be/${YT}` }))).toBe(
      AUDIO_NOT_ALLOWED_COPY,
    );
    expect(
      msg(() =>
        v({ ...base, source: "link", provider: "youtube", provider_id: YT }),
      ),
    ).toBe(AUDIO_NOT_ALLOWED_COPY);
  });

  it("media source needs an asset", () => {
    expect(msg(() => v({ ...base }))).toBe(AUDIO_SOURCE_COPY);
    expect(v({ ...base, asset: "m1" })).toMatchObject({
      source: "media",
      asset: "m1",
    });
  });
});

describe("embed item", () => {
  const base = { id: "e", kind: "embed", title: "Book a consultation" };

  it("requires a title", () => {
    expect(
      msg(() => v({ ...base, title: "", link: "https://calendly.com/acme" })),
    ).toBe(EMBED_TITLE_COPY);
  });

  it("accepts Calendly and Google Calendar only", () => {
    expect(v({ ...base, link: "https://calendly.com/acme/30min" })).toEqual({
      id: "e",
      kind: "embed",
      title: "Book a consultation",
      provider: "calendly",
      provider_id: "acme/30min",
    });
    expect(
      v({
        ...base,
        link: "https://calendar.google.com/calendar/embed?src=a%40b.com",
      }),
    ).toMatchObject({ provider: "google-calendar", provider_id: "a@b.com" });
    for (const link of [
      `https://youtu.be/${YT}`,
      "https://calendly.com.evil.net/acme",
      "javascript:alert(1)",
    ]) {
      expect(msg(() => v({ ...base, link }))).toBe(EMBED_NOT_ALLOWED_COPY);
    }
  });
});

describe("form item", () => {
  it("needs a valid form id", () => {
    for (const bad of ["", "  ", "../x", "a b", 7, null]) {
      expect(msg(() => v({ id: "f", kind: "form", form_id: bad }))).toBe(
        FORM_ITEM_COPY,
      );
    }
    expect(v({ id: "f", kind: "form", form_id: "form1", extra: 1 })).toEqual({
      id: "f",
      kind: "form",
      form_id: "form1",
    });
  });
});

describe("image item library asset", () => {
  it("asset + alt clears url", () => {
    expect(
      v({
        id: "i",
        kind: "image",
        url: "https://x.test/a.jpg",
        alt: "Room",
        asset: "a1",
      }),
    ).toEqual({ id: "i", kind: "image", url: "", alt: "Room", asset: "a1" });
  });

  it("asset with blank alt throws ALT_COPY", () => {
    expect(
      msg(() => v({ id: "i", kind: "image", asset: "a1", alt: " " })),
    ).toBe(ALT_COPY);
  });

  it("no asset: no asset key", () => {
    const out = v({ id: "i", kind: "image", url: "", alt: "", asset: "" });
    expect(out).toEqual({ id: "i", kind: "image", url: "", alt: "" });
    expect(out).not.toHaveProperty("asset");
  });

  it("malformed asset throws", () => {
    expect(
      msg(() => v({ id: "i", kind: "image", asset: "../etc", alt: "x" })),
    ).toBe(MALFORMED_COPY);
  });
});

describe("pop-ups accept the P7 kinds", () => {
  it("validatePopup with video, audio, form and embed items passes", () => {
    const out = validatePopup({
      name: "Watch",
      content: {
        items: [
          {
            id: "v",
            kind: "video",
            title: "Tour",
            link: `https://youtu.be/${YT}`,
          },
          { id: "a", kind: "audio", title: "Ep", asset: "m1" },
          { id: "f", kind: "form", form_id: "form1" },
          {
            id: "e",
            kind: "embed",
            title: "Book",
            link: "https://calendly.com/acme",
          },
        ],
      },
      trigger: "delay",
      delay_seconds: 5,
      scroll_percent: 50,
      frequency: "once-per-visitor",
      show_on: "all-pages",
    });
    expect(out.content.items.map((i) => i.kind)).toEqual([
      "video",
      "audio",
      "form",
      "embed",
    ]);
  });
});
