// Hours, social and map renderers (07-24; CONT-24, CONT-27, D198, D230, D257, D279;
// T-07-24-01..03). Server markup only; the islands have their own jsdom tests.
import {
  defaultHoursBlock,
  defaultMapBlock,
  defaultSocialBlock,
  mapDirectionsUrl,
  socialShareHref,
  type HoursBlockContent,
  type MapBlockContent,
  type SocialBlockContent,
} from "@cds/core/content";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { thirdPartyLoads } from "../../test-support/consent-scan";
import type { CoreBoundData } from "../types";
import { HoursSection } from "./HoursSection";
import { MapSection } from "./MapSection";
import { SocialSection } from "./SocialSection";

// Wednesday 7 Oct 2026, 10:00 in Chicago.
const NOW = new Date("2026-10-07T15:00:00.000Z");
const base = {
  layout: "full" as const,
  background: "main" as const,
  isH1Owner: false,
  isFirst: false,
  now: NOW,
};
const nineFive = { open: true, ranges: [{ start: "09:00", end: "17:00" }] };
const shut = { open: false, ranges: [] };
const HOURS = {
  mon: nineFive,
  tue: nineFive,
  wed: nineFive,
  thu: nineFive,
  fri: nineFive,
  sat: shut,
  sun: shut,
};
const BUSINESS = {
  name: "Rivera Bakery",
  phone: "+1 (512) 555-0100",
  public_email: "hi@rivera.example",
  address: { street: "12 Main St", city: "Austin", state: "TX", zip: "78701" },
  time_zone: "America/Chicago",
  hours: HOURS,
  socials: [
    { platform: "instagram", url: "https://instagram.com/rivera" },
    { platform: "facebook", url: "https://facebook.com/rivera" },
    { platform: "other", url: "https://www.yelp.com/biz/rivera" },
    { platform: "x", url: "javascript:alert(1)" },
  ],
};
const data = (
  over: Partial<CoreBoundData> = {},
  business: unknown = BUSINESS,
) => ({ media: {}, business, ...over }) as CoreBoundData;

const hours = (c: Partial<HoursBlockContent>, coreData?: CoreBoundData) =>
  renderToStaticMarkup(
    <HoursSection
      {...base}
      content={{ ...defaultHoursBlock(), ...c }}
      coreData={coreData}
    />,
  );
const social = (c: Partial<SocialBlockContent>, coreData?: CoreBoundData) =>
  renderToStaticMarkup(
    <SocialSection
      {...base}
      content={{ ...defaultSocialBlock(), ...c }}
      coreData={coreData}
    />,
  );
const map = (c: Partial<MapBlockContent>, coreData?: CoreBoundData) =>
  renderToStaticMarkup(
    <MapSection
      {...base}
      content={{ ...defaultMapBlock(), ...c }}
      coreData={coreData}
    />,
  );

const NO_HEX = /#[0-9a-fA-F]{3,6}\b/;

describe("HoursSection", () => {
  it("renders the heading, a captioned 7-row table, today bold and the zone", () => {
    const html = hours({}, data());
    expect(html).toContain("<h2");
    expect(html).toContain("Opening hours</h2>");
    expect(html).toContain('<caption class="sr-only">Opening hours</caption>');
    expect(html.match(/<tr\b/g)).toHaveLength(7);
    expect(html.indexOf("Monday")).toBeLessThan(html.indexOf("Sunday"));
    expect(html).toMatch(/text-site-text-muted[^>]*><th[^>]*>Saturday/);
    expect(html).toMatch(
      /<th scope="row" class="[^"]*font-semibold[^"]*">Wednesday/,
    );
    expect(html).toMatch(
      /<th scope="row" class="[^"]*font-normal[^"]*">Monday/,
    );
    expect(html).toContain("9:00 am to 5:00 pm");
    expect(html).toContain("Times are in Central Time");
    expect(html).not.toMatch(NO_HEX);
  });

  it("reserves the Open-now slot empty for the island, with a noscript collapse", () => {
    const html = hours({}, data());
    expect(html).toMatch(
      /<div data-open-now="" class="min-h-\[44px\]"><\/div>/,
    );
    expect(html).toContain(
      "<noscript><style>[data-open-now]{display:none}</style></noscript>",
    );
    expect(html).not.toContain("Open now ·");
    expect(hours({ show_open_now: false }, data())).not.toContain(
      "data-open-now",
    );
  });

  it("no hours: contact sentence with tel and mailto links", () => {
    const html = hours({}, data({}, { ...BUSINESS, hours: null }));
    expect(html).toContain("Contact us for hours.");
    expect(html).toContain('href="tel:+15125550100"');
    expect(html).toContain('href="mailto:hi@rivera.example"');
    expect(html).not.toContain("<table");
  });

  it("no hours and no contacts, or no business at all: just the sentence", () => {
    const bare = hours(
      {},
      data({}, { ...BUSINESS, hours: null, phone: "", public_email: "" }),
    );
    expect(bare).toContain("Contact us for hours.");
    expect(bare).not.toContain("href=");
    const none = hours({}, { media: {} });
    expect(none).toContain("Contact us for hours.");
    expect(hours({}, undefined)).toContain("Contact us for hours.");
  });

  it("malformed hours are treated as none (never a crash)", () => {
    const html = hours({}, data({}, { ...BUSINESS, hours: { mon: "x" } }));
    expect(html).toContain("Contact us for hours.");
  });
});

describe("SocialSection", () => {
  const share = { url: "https://rivera.example/menu", title: "Menu" };

  it("renders monochrome brand links named for the business", () => {
    const html = social({}, data({ share }));
    expect(html).toContain('aria-label="Rivera Bakery on Instagram"');
    expect(html).toContain('aria-label="Rivera Bakery on Facebook"');
    expect(html).toContain('aria-label="Rivera Bakery on yelp.com"');
    expect(html).toMatch(/rel="me noopener noreferrer"/);
    expect(html).toMatch(/<svg[^>]*fill="currentColor"[^>]*aria-hidden="true"/);
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(NO_HEX);
  });

  it("renders the share row with plain share links and Copy link", () => {
    const html = social({}, data({ share }));
    expect(html).toContain("Share this page");
    const fb = socialShareHref("facebook", share)!.replace(/&/g, "&amp;");
    const x = socialShareHref("x", share)!.replace(/&/g, "&amp;");
    const mail = socialShareHref("email", share)!.replace(/&/g, "&amp;");
    expect(html).toContain(
      `href="${fb}" target="_blank" rel="noopener noreferrer"`,
    );
    expect(html).toContain(`href="${x}" target="_blank"`);
    expect(html).toMatch(
      new RegExp(`href="${mail.replace(/[?.*+]/g, "\\$&")}" class=`),
    );
    expect(html).toMatch(/<button type="button"[^>]*>.*Copy link<\/button>/);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<script");
    expect(thirdPartyLoads(html)).toEqual([]);
  });

  it("no socials and share off renders nothing", () => {
    expect(
      social({ show_share: false }, data({}, { ...BUSINESS, socials: [] })),
    ).toBe("");
    expect(social({ show_share: false, show_socials: false }, data())).toBe("");
  });

  it("share on without share data (builder preview): inert look-alikes", () => {
    const html = social({}, data());
    expect(html).toContain("Share this page");
    expect(html).not.toContain("sharer.php");
    expect(html).not.toMatch(/<button type="button"[^>]*>.*Copy link/);
    expect(html).toMatch(
      /<span class="[^"]*border-site-text[^"]*">.*Copy link<\/span>/,
    );
  });
});

describe("MapSection", () => {
  const ADDRESS = "12 Main St, Austin, TX 78701";

  it("uses the business address; the MapLibre map loads client-side, no frame", () => {
    const html = map({}, data());
    expect(html).toContain("Find us</h2>");
    expect(html).toContain(ADDRESS);
    expect(html).not.toContain("<iframe");
    expect(thirdPartyLoads(html)).toEqual([]);
  });

  it("links Get directions with an accessible name", () => {
    const html = map({}, data());
    const href = mapDirectionsUrl(ADDRESS).replace(/&/g, "&amp;");
    expect(html).toContain(
      `href="${href}" target="_blank" rel="noopener noreferrer"`,
    );
    expect(html).toContain(
      'Get directions<span class="sr-only"> (opens Google Maps in a new tab)</span>',
    );
    expect(map({ show_directions: false }, data())).not.toContain(
      "Get directions",
    );
  });

  it("the block location overrides the business address", () => {
    const html = map({ location: "Rivera Bakery" }, data());
    expect(html).toContain("Rivera Bakery");
    expect(html).toContain(
      mapDirectionsUrl("Rivera Bakery").replace(/&/g, "&amp;"),
    );
    expect(html).not.toContain("12 Main St");
  });

  it("no address anywhere renders nothing", () => {
    const empty = { street: "", city: "", state: "", zip: "" };
    expect(map({}, data({}, { ...BUSINESS, address: empty }))).toBe("");
    expect(map({}, undefined)).toBe("");
  });

  it("never prints a frame URL, even with a key", () => {
    const html = map(
      {},
      data({ mapKey: "AIzaSyA-valid_key_1234567890abcdef" }),
    );
    expect(html).not.toContain("output=embed");
    expect(html).not.toContain("embed/v1");
    expect(thirdPartyLoads(html)).toEqual([]);
  });
});
