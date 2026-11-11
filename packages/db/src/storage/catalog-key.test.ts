// 13-20 (T-13-20-02): platformCatalogKey keeps every segment inside platform/catalog/<slug>/.
import { InvalidInput } from "@cds/core";
import { afterEach, describe, expect, it } from "vitest";
import { platformCatalogKey, platformCatalogPrefix } from "./keys";

const ENV = process.env.CDS_ENV;

afterEach(() => {
  if (ENV === undefined) delete process.env.CDS_ENV;
  else process.env.CDS_ENV = ENV;
});

describe("platformCatalogKey", () => {
  it("builds platform/catalog/<slug>/<id>.<ext> under the env prefix", () => {
    delete process.env.CDS_ENV;
    expect(platformCatalogKey("events", "abc123", "png")).toBe(
      "dev/platform/catalog/events/abc123.png",
    );
    process.env.CDS_ENV = "production";
    expect(platformCatalogPrefix("events")).toBe("platform/catalog/events/");
  });

  it("refuses traversal, slashes and unknown extensions", () => {
    expect(() => platformCatalogKey("../x", "a", "png")).toThrow(InvalidInput);
    expect(() => platformCatalogKey("events", "../x", "png")).toThrow(
      InvalidInput,
    );
    expect(() => platformCatalogKey("events", "a/b", "png")).toThrow(
      InvalidInput,
    );
    expect(() => platformCatalogKey("events", "a", "svg")).toThrow(
      InvalidInput,
    );
    expect(() => platformCatalogKey("events", "a", "png/../x")).toThrow(
      InvalidInput,
    );
  });
});
