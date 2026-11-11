// Map block (07-07; CONT-24, D230; T-07-07-01 hostile link corpus).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  MAP_LINK_COPY,
  MAP_LOCATION_MAX,
  MAP_SHORT_LINK_COPY,
  defaultMapBlock,
  mapSection,
  parseMapLink,
  validateMapBlock,
} from "./map";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

describe("parseMapLink", () => {
  it("reads a plain address; blank or non-string is null", () => {
    expect(parseMapLink("12 Main St, Austin TX")).toEqual({
      query: "12 Main St, Austin TX",
    });
    expect(parseMapLink("  12   Main\tSt  ")).toEqual({ query: "12 Main St" });
    expect(parseMapLink("")).toBeNull();
    expect(parseMapLink("   ")).toBeNull();
    expect(parseMapLink(undefined)).toBeNull();
    expect(parseMapLink(42)).toBeNull();
    expect(parseMapLink({ query: "x" })).toBeNull();
  });

  it("reads Google Maps place, search, ?q=, @lat,lng, query and destination", () => {
    expect(
      parseMapLink(
        "https://www.google.com/maps/place/Rivera+Bakery/@30.26,-97.74,17z",
      ),
    ).toEqual({ query: "Rivera Bakery" });
    expect(parseMapLink("https://maps.google.com/?q=12+Main+St")).toEqual({
      query: "12 Main St",
    });
    expect(
      parseMapLink("https://www.google.co.uk/maps/search/coffee+austin"),
    ).toEqual({ query: "coffee austin" });
    expect(
      parseMapLink("https://www.google.com/maps/@30.2672,-97.7431,15z"),
    ).toEqual({ query: "30.2672,-97.7431" });
    expect(
      parseMapLink("https://www.google.com/maps/search/?api=1&query=Rivera"),
    ).toEqual({ query: "Rivera" });
    expect(
      parseMapLink(
        "https://www.google.com/maps/dir/?api=1&destination=1+Main+St",
      ),
    ).toEqual({ query: "1 Main St" });
    expect(
      parseMapLink("http://google.com/maps/place/Caf%C3%A9%20Uno"),
    ).toEqual({ query: "Café Uno" });
  });

  it("refuses hostile and non-maps links", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://google.com.evil.com/maps?q=x",
      "https://evil.com/?q=google.com/maps",
      "https://user@www.google.com/maps?q=x",
      "https://user:pw@www.google.com/maps?q=x",
      "https://www.google.com/search?q=x",
      "ftp://www.google.com/maps?q=x",
      "https://www.google.com/maps",
      "https://www.google.com/maps/@999,999,15z",
      "https://xgoogle.com/maps?q=x",
      "https://www.google.evil/maps?q=x",
      "mailto:a@b.c",
    ]) {
      expect(msg(() => parseMapLink(bad))).toBe(MAP_LINK_COPY);
    }
  });

  it("refuses short goo.gl links with their own copy", () => {
    expect(msg(() => parseMapLink("https://maps.app.goo.gl/abc"))).toBe(
      MAP_SHORT_LINK_COPY,
    );
    expect(msg(() => parseMapLink("https://goo.gl/maps/abc"))).toBe(
      MAP_SHORT_LINK_COPY,
    );
  });

  it("strips control characters and caps length", () => {
    expect(parseMapLink("12 Main\u0000 St\u0007")).toEqual({
      query: "12 Main St",
    });
    expect(msg(() => parseMapLink("a".repeat(MAP_LOCATION_MAX + 1)))).toBe(
      "Keep this under 300 characters.",
    );
  });
});

describe("validateMapBlock", () => {
  it("stores the parsed query and defaults booleans", () => {
    const v = validateMapBlock({
      heading: " Visit ",
      location: "https://maps.google.com/?q=12+Main+St",
      extra: "dropped",
    });
    expect(v).toEqual({
      heading: "Visit",
      location: "12 Main St",
      show_directions: true,
    });
    expect(validateMapBlock({ show_directions: false }).show_directions).toBe(
      false,
    );
    expect(validateMapBlock({ show_directions: "false" }).show_directions).toBe(
      true,
    );
  });

  it("refuses non-objects", () => {
    expect(msg(() => validateMapBlock("x"))).toBe(
      "This block's content is malformed.",
    );
    expect(msg(() => validateMapBlock([1]))).toBe(
      "This block's content is malformed.",
    );
  });

  it("refuses a bad link at save", () => {
    expect(msg(() => validateMapBlock({ location: "javascript:x" }))).toBe(
      MAP_LINK_COPY,
    );
  });
});

describe("mapSection", () => {
  it("contract", () => {
    expect(mapSection.type).toBe("map");
    expect(mapSection.label).toBe("Map");
    expect(mapSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(mapSection.headings).toEqual({ ownsH1: false, blockHeading: "h2" });
    expect(mapSection.refsOf({})).toEqual({ popups: [], forms: [], media: [] });
    expect(mapSection.refsOf(null)).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
    const d = defaultMapBlock();
    expect(d).toEqual({
      heading: "Find us",
      location: "",
      show_directions: true,
    });
    expect(mapSection.validate(d, "full")).toEqual(d);
    expect(mapSection.textsOf({ heading: "A", location: "B" })).toEqual([
      "A",
      "B",
    ]);
    expect(mapSection.urlsOf(d)).toEqual([]);
    const copy = mapSection.mapRichText(d, (h) => h);
    expect(copy).toEqual(d);
    expect(copy).not.toBe(d);
    for (const bad of [null, undefined, 5, "x", []]) {
      expect(() => mapSection.textsOf(bad)).not.toThrow();
      expect(() => mapSection.urlsOf(bad)).not.toThrow();
    }
  });
});

describe("mapAddressQuery / mapDirectionsUrl (07-24)", () => {
  it("joins the present address parts", async () => {
    const { mapAddressQuery } = await import("./map");
    expect(
      mapAddressQuery({
        street: "12 Main St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      }),
    ).toBe("12 Main St, Austin, TX 78701");
    expect(
      mapAddressQuery({ street: "", city: "Austin", state: "TX", zip: "" }),
    ).toBe("Austin, TX");
    expect(mapAddressQuery({ street: "", city: "", state: "", zip: "" })).toBe(
      "",
    );
    expect(mapAddressQuery(null)).toBe("");
    expect(mapAddressQuery("12 Main St")).toBe("");
  });

  it("builds the directions link", async () => {
    const { mapDirectionsUrl } = await import("./map");
    expect(mapDirectionsUrl("12 Main St, Austin")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=12%20Main%20St%2C%20Austin",
    );
    expect(mapDirectionsUrl("")).toBe("");
    expect(mapDirectionsUrl("   ")).toBe("");
  });
});
