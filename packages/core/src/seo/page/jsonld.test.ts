// 07-30 Task 1: JSON-LD builder, escaping and add-on node sanitizing (CONT-13, Pitfall 15).
import { describe, expect, it } from "vitest";
import type { PublishedSection } from "../../content/types";
import {
  buildJsonLd,
  sanitizeAddonNodes,
  serializeJsonLd,
  type JsonLdInput,
} from "./jsonld";

const ORIGIN = "https://rivera.com";

function section(
  id: string,
  section_type: string,
  content: unknown,
): PublishedSection {
  return {
    id,
    section_type,
    row_layout: "full",
    content,
    settings: { background_variant: "main" },
  };
}

const HOURS = {
  mon: { open: true, ranges: [{ start: "09:00", end: "17:00" }] },
  tue: { open: false, ranges: [] },
  wed: {
    open: true,
    ranges: [
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
    ],
  },
  thu: { open: false, ranges: [] },
  fri: { open: false, ranges: [] },
  sat: { open: false, ranges: [] },
  sun: { open: false, ranges: [] },
};

function fullInput(over: Partial<JsonLdInput> = {}): JsonLdInput {
  return {
    origin: ORIGIN,
    pageUrl: `${ORIGIN}/about-us`,
    page: {
      title: "About us",
      slug: "about-us",
      isHome: false,
      publishedAt: "2026-10-01T12:00:00.000Z",
    },
    business: {
      name: "Rivera Salon",
      businessType: "hair-salon",
      phone: "555-0100",
      email: "hi@rivera.com",
      address: {
        street: "1 Main St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
      timeZone: "America/Chicago",
      hours: HOURS,
      socials: [
        { url: "https://instagram.com/rivera" },
        { url: "https://facebook.com/rivera" },
        { url: "/about-us" },
        { url: "/\\evil.example/x" },
      ],
      logoUrl: "/_site/icon-512.png?v=abc",
    },
    services: [
      { name: "Cut", description: "A cut", priceCents: 4500 },
      { name: "Consult" },
    ],
    team: [{ name: "Ana Silva", role: "Stylist" }],
    sections: [
      section("s1", "faq", {
        heading: "",
        open_first: false,
        items: [
          {
            id: "q1",
            question: "Do you take walk-ins?",
            answer: "<p>Yes, <strong>most</strong> days.</p>",
          },
          { id: "q2", question: "Parking?", answer: "<p>Free lot.</p>" },
          { id: "q3", question: "Unanswered?", answer: "<p></p>" },
        ],
      }),
      section("s2", "columns", {
        columns: [
          {
            id: "c1",
            items: [
              {
                id: "v1",
                kind: "video",
                title: "Our salon",
                source: "media",
                asset: "vid000000000001",
                provider: "",
                provider_id: "",
                cover: "img000000000001",
                shape: "16:9",
                controls: true,
                loop: false,
                autoplay: false,
              },
              {
                id: "v2",
                kind: "video",
                title: "No thumbnail",
                source: "media",
                asset: "vid000000000002",
                provider: "",
                provider_id: "",
                cover: "",
                shape: "16:9",
                controls: true,
                loop: false,
                autoplay: false,
              },
            ],
          },
        ],
      }),
    ],
    media: {
      vid000000000001: { src: "/_media/vid000000000001/video.mp4" },
      vid000000000002: { src: "/_media/vid000000000002/video.mp4" },
      img000000000001: {
        src: "/_media/img000000000001/w960.webp",
        width: 960,
        height: 540,
      },
    },
    addonNodes: [],
    ...over,
  };
}

type Node = Record<string, unknown>;

function nodes(input: JsonLdInput): Node[] {
  return buildJsonLd(input)["@graph"];
}

function ofType(list: Node[], type: string): Node[] {
  return list.filter((n) => n["@type"] === type);
}

describe("serializeJsonLd (T-07-30-01)", () => {
  it("never lets a tenant string close the script", () => {
    const value = { name: "</script><script>alert(1)</script> & co" };
    const out = serializeJsonLd(value);
    expect(out).not.toContain("<");
    expect(out).not.toContain("</script");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).toContain("\\u003c");
    expect(JSON.parse(out)).toEqual(value);
  });

  it("escapes U+2028 and U+2029", () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const value = { a: `line${LS}sep${PS}para` };
    const out = serializeJsonLd(value);
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(out).not.toContain(LS);
    expect(out).not.toContain(PS);
    expect(JSON.parse(out)).toEqual(value);
  });
});

describe("buildJsonLd (CONT-13, D188, D253)", () => {
  it("builds one graph with business, page, breadcrumbs, FAQ and one video", () => {
    const g = buildJsonLd(fullInput());
    expect(g["@context"]).toBe("https://schema.org");
    const list = g["@graph"];
    const [biz] = ofType(list, "HairSalon");
    expect(biz?.["@id"]).toBe(`${ORIGIN}/#business`);
    expect(biz?.sameAs).toEqual([
      "https://instagram.com/rivera",
      "https://facebook.com/rivera",
    ]);
    expect(biz?.logo).toBe(`${ORIGIN}/_site/icon-512.png?v=abc`);
    expect(biz?.openingHoursSpecification).toHaveLength(3);
    const offers = biz?.makesOffer as Node[];
    expect(offers).toHaveLength(2);
    expect(offers[0]?.priceSpecification).toEqual({
      "@type": "PriceSpecification",
      price: "45.00",
      priceCurrency: "USD",
    });
    expect(offers[1]?.priceSpecification).toBeUndefined();
    expect(biz?.employee).toEqual([
      { "@type": "Person", name: "Ana Silva", jobTitle: "Stylist" },
    ]);
    expect((biz?.address as Node).addressLocality).toBe("Austin");

    const [page] = ofType(list, "WebPage");
    expect(page?.url).toBe(`${ORIGIN}/about-us`);
    expect(page?.about).toEqual({ "@id": `${ORIGIN}/#business` });
    expect((page?.isPartOf as Node)["@type"]).toBe("WebSite");

    const [crumbs] = ofType(list, "BreadcrumbList");
    expect((crumbs?.itemListElement as Node[]).map((i) => i.name)).toEqual([
      "Home",
      "About us",
    ]);

    const [faq] = ofType(list, "FAQPage");
    const qs = faq?.mainEntity as Node[];
    expect(qs).toHaveLength(2);
    expect((qs[0]?.acceptedAnswer as Node).text).toBe("Yes, most days.");

    const videos = ofType(list, "VideoObject");
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      name: "Our salon",
      thumbnailUrl: `${ORIGIN}/_media/img000000000001/w960.webp`,
      uploadDate: "2026-10-01T12:00:00.000Z",
      contentUrl: `${ORIGIN}/_media/vid000000000001/video.mp4`,
    });
  });

  it("uses an embed URL for a linked video with a cover", () => {
    const input = fullInput({
      sections: [
        section("s1", "columns", {
          columns: [
            {
              id: "c",
              items: [
                {
                  id: "v",
                  kind: "video",
                  title: "Tour",
                  source: "link",
                  asset: "",
                  provider: "youtube",
                  provider_id: "dQw4w9WgXcQ",
                  cover: "img000000000001",
                  shape: "16:9",
                  controls: true,
                  loop: false,
                  autoplay: false,
                },
              ],
            },
          ],
        }),
      ],
    });
    const [video] = ofType(nodes(input), "VideoObject");
    expect(typeof video?.embedUrl).toBe("string");
    expect(video?.contentUrl).toBeUndefined();
  });

  it("omits missing business data and has no breadcrumbs on home", () => {
    const list = nodes(
      fullInput({
        page: { title: "Home", slug: "home", isHome: true, publishedAt: "" },
        pageUrl: `${ORIGIN}/`,
        business: {
          name: "Plain Co",
          businessType: "not-a-type",
          socials: [],
          hours: null,
        },
        services: [],
        team: [],
        sections: [],
      }),
    );
    const [biz] = ofType(list, "LocalBusiness");
    expect(biz).toBeDefined();
    for (const key of [
      "address",
      "openingHoursSpecification",
      "sameAs",
      "makesOffer",
      "employee",
      "telephone",
      "logo",
    ]) {
      expect(biz, key).not.toHaveProperty(key);
    }
    expect(JSON.stringify(list)).not.toContain('""');
    expect(JSON.stringify(list)).not.toContain("null");
    expect(ofType(list, "BreadcrumbList")).toHaveLength(0);
    expect(ofType(list, "FAQPage")).toHaveLength(0);
  });

  it("appends sanitized add-on nodes", () => {
    const list = nodes(
      fullInput({ addonNodes: [{ "@type": "Event", name: "Open house" }, 7] }),
    );
    expect(ofType(list, "Event")).toHaveLength(1);
  });

  it("never throws on malformed sections", () => {
    expect(() =>
      buildJsonLd(
        fullInput({
          sections: [null, 5, { section_type: "faq", content: null }] as never,
        }),
      ),
    ).not.toThrow();
  });
});

describe("sanitizeAddonNodes (T-07-30-10)", () => {
  it("drops non-objects and nodes without a string @type", () => {
    expect(
      sanitizeAddonNodes([1, "x", null, [], { name: "x" }, { "@type": 3 }]),
    ).toEqual([]);
    expect(sanitizeAddonNodes("nope")).toEqual([]);
  });

  it("drops nodes deeper than 6 levels and truncates long strings", () => {
    const deep = {
      "@type": "Thing",
      a: { b: { c: { d: { e: { f: { g: 1 } } } } } },
    };
    const ok = { "@type": "Thing", text: "x".repeat(6000) };
    const out = sanitizeAddonNodes([deep, ok]);
    expect(out).toHaveLength(1);
    expect((out[0]?.text as string).length).toBe(5000);
  });

  it("keeps at most 20 nodes", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      "@type": "Thing",
      i,
    }));
    expect(sanitizeAddonNodes(many)).toHaveLength(20);
  });

  it("survives throwing getters and cycles", () => {
    const hostile = {
      "@type": "Thing",
      get boom(): string {
        throw new Error("x");
      },
    };
    const cyc: Record<string, unknown> = { "@type": "Thing" };
    cyc.self = cyc;
    const good = { "@type": "Thing", name: "ok" };
    expect(() => sanitizeAddonNodes([hostile, cyc, good])).not.toThrow();
    expect(sanitizeAddonNodes([hostile, cyc, good])).toEqual([good]);
  });
});
