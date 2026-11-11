// Column item walkers (07-04; T-07-04-04: defensive against malformed content).
import { describe, expect, it } from "vitest";
import type { ColumnItem } from "../types";
import {
  columnsItems,
  columnsRefs,
  itemRefs,
  itemTexts,
  itemUrls,
  nonEmpty,
} from "./walk";

const items: ColumnItem[] = [
  { id: "h", kind: "heading", text: "Title", level: 2 },
  { id: "t", kind: "text", html: "<p>Body</p>" },
  { id: "l", kind: "list", items: ["one", "two"] },
  { id: "i", kind: "image", url: "https://x.test/a.jpg", alt: "Alt" },
  {
    id: "b",
    kind: "button",
    text: "Go",
    link: "/go",
    style: "primary",
    action: "link",
    popup_id: "",
  },
  {
    id: "p",
    kind: "button",
    text: "Open",
    link: "",
    style: "secondary",
    action: "popup",
    popup_id: "pop1",
  },
  { id: "s", kind: "spacer", height: "md" },
  { id: "d", kind: "divider" },
  {
    id: "k",
    kind: "countdown",
    target_at: "2027-01-01T00:00:00Z",
    zero_message: "Now",
  },
];

const content = { columns: [{ id: "c1", items }] };

describe("nonEmpty", () => {
  it("drops undefined, empty strings and non-strings", () => {
    expect(nonEmpty(["a", "", undefined, 5 as unknown as string, "b"])).toEqual(
      ["a", "b"],
    );
  });
});

describe("item walkers", () => {
  it("itemTexts covers every text-bearing kind", () => {
    expect(items.flatMap(itemTexts)).toEqual([
      "Title",
      "<p>Body</p>",
      "one",
      "two",
      "Alt",
      "Go",
      "Open",
      "Now",
    ]);
  });

  it("itemUrls gives button links and image urls", () => {
    expect(nonEmpty(items.flatMap(itemUrls))).toEqual([
      "https://x.test/a.jpg",
      "/go",
    ]);
  });

  it("itemRefs reports only popup buttons", () => {
    expect(itemRefs(items[5]!)).toEqual({
      popups: ["pop1"],
      forms: [],
      media: [],
    });
    expect(itemRefs(items[4]!)).toEqual({ popups: [], forms: [], media: [] });
    expect(itemRefs(items[0]!)).toEqual({ popups: [], forms: [], media: [] });
  });

  it("unknown kinds yield nothing", () => {
    const odd = { id: "x", kind: "hologram" } as unknown as ColumnItem;
    expect(itemTexts(odd)).toEqual([]);
    expect(itemUrls(odd)).toEqual([]);
    expect(itemRefs(odd)).toEqual({ popups: [], forms: [], media: [] });
  });
});

describe("columns walkers", () => {
  it("columnsItems flattens every column", () => {
    expect(
      columnsItems({
        columns: [
          { id: "a", items: [items[0]] },
          { id: "b", items: [items[1]] },
        ],
      }).map((i) => i.id),
    ).toEqual(["h", "t"]);
  });

  it("columnsRefs unions item refs", () => {
    expect(columnsRefs(content)).toEqual({
      popups: ["pop1"],
      forms: [],
      media: [],
    });
  });

  it("malformed content yields empty results", () => {
    for (const bad of [
      undefined,
      null,
      5,
      "x",
      [],
      { columns: "nope" },
      { columns: [null, 5, { id: "a", items: "no" }, { id: "b" }] },
      { columns: [{ id: "a", items: [null, 3, { kind: 7 }] }] },
    ]) {
      expect(columnsRefs(bad)).toEqual({ popups: [], forms: [], media: [] });
      expect(nonEmpty(columnsItems(bad).flatMap(itemTexts))).toEqual([]);
      expect(nonEmpty(columnsItems(bad).flatMap(itemUrls))).toEqual([]);
    }
  });
});

describe("P7 item kinds (07-08)", () => {
  const YT = "dQw4w9WgXcQ";
  const video: ColumnItem = {
    id: "v",
    kind: "video",
    title: "Tour",
    source: "link",
    asset: "",
    provider: "youtube",
    provider_id: YT,
    cover: "c1",
    shape: "16:9",
    controls: true,
    loop: false,
    autoplay: false,
  };
  const uploaded: ColumnItem = {
    ...video,
    id: "u",
    source: "media",
    asset: "m1",
    provider: "",
    provider_id: "",
    cover: "",
  } as ColumnItem;
  const audio: ColumnItem = {
    id: "a",
    kind: "audio",
    title: "Ep 4",
    source: "media",
    asset: "m2",
    provider: "",
    provider_id: "",
  };
  const embed: ColumnItem = {
    id: "e",
    kind: "embed",
    title: "Book",
    provider: "calendly",
    provider_id: "acme",
  };
  const form1: ColumnItem = { id: "f1", kind: "form", form_id: "form1" };
  const form2: ColumnItem = { id: "f2", kind: "form", form_id: "form1" };
  const image: ColumnItem = {
    id: "i",
    kind: "image",
    url: "",
    alt: "Room",
    asset: "m3",
  };

  it("itemTexts: titles; forms have none", () => {
    expect([video, audio, embed, form1].flatMap(itemTexts)).toEqual([
      "Tour",
      "Ep 4",
      "Book",
    ]);
  });

  it("itemUrls: the rebuilt embed URL for link sources only", () => {
    expect(itemUrls(video)).toEqual([
      `https://www.youtube-nocookie.com/embed/${YT}`,
    ]);
    expect(itemUrls(uploaded)).toEqual([]);
    expect(itemUrls(audio)).toEqual([]);
    expect(itemUrls(form1)).toEqual([]);
    expect(itemUrls(embed)).toEqual([
      "https://calendly.com/acme?embed_type=Inline&hide_gdpr_banner=1",
    ]);
    expect(itemUrls({ ...video, provider_id: "bad" } as ColumnItem)).toEqual(
      [],
    );
  });

  it("itemRefs: media and forms", () => {
    expect(itemRefs(video)).toEqual({ popups: [], forms: [], media: ["c1"] });
    expect(itemRefs(uploaded)).toEqual({
      popups: [],
      forms: [],
      media: ["m1"],
    });
    expect(itemRefs(audio).media).toEqual(["m2"]);
    expect(itemRefs(form1)).toEqual({
      popups: [],
      forms: ["form1"],
      media: [],
    });
    expect(itemRefs(image).media).toEqual(["m3"]);
    expect(itemRefs(embed)).toEqual({ popups: [], forms: [], media: [] });
    expect(
      itemRefs({
        id: "x",
        kind: "image",
        url: "https://x.test/a.jpg",
        alt: "a",
      }).media,
    ).toEqual([]);
  });

  it("columnsRefs de-duplicates form and media ids", () => {
    expect(
      columnsRefs({
        columns: [
          { id: "c1", items: [form1, uploaded] },
          { id: "c2", items: [form2, { ...uploaded, id: "u2" }] },
        ],
      }),
    ).toEqual({ popups: [], forms: ["form1"], media: ["m1"] });
  });
});
