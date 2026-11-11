// Shared public price labels (HUB-05, D264, P15-P5). Same cases /start relies on.
import { describe, expect, it } from "vitest";
import {
  PRICE_SOON,
  catalogRow,
  pathPriceLine,
  priceLabelFor,
  type CatalogRow,
} from "./index";

const row = (
  r: Partial<CatalogRow> & Pick<CatalogRow, "itemKind" | "itemKey" | "path">,
): CatalogRow => ({
  monthlyCents: null,
  oneTimeCents: null,
  installments: null,
  ...r,
});

const CATALOG: CatalogRow[] = [
  row({
    itemKind: "build_fee",
    itemKey: "base",
    path: "standard",
    oneTimeCents: 150000,
  }),
  row({
    itemKind: "plan",
    itemKey: "base",
    path: "standard",
    monthlyCents: 3900,
  }),
  row({
    itemKind: "build_fee",
    itemKey: "base",
    path: "studio",
    oneTimeCents: 250000,
  }),
  row({ itemKind: "plan", itemKey: "base", path: "studio" }),
  row({
    itemKind: "addon",
    itemKey: "newsletter",
    path: "standard",
    monthlyCents: 900,
  }),
];

describe("PRICE_SOON", () => {
  it("is the one unpriced wording", () => {
    expect(PRICE_SOON).toBe("Price coming soon");
  });
});

describe("catalogRow", () => {
  it("finds a row by kind, key and path", () => {
    expect(
      catalogRow(CATALOG, "addon", "newsletter", "standard")?.monthlyCents,
    ).toBe(900);
  });
  it("is undefined when missing or the catalog is null", () => {
    expect(
      catalogRow(CATALOG, "addon", "newsletter", "studio"),
    ).toBeUndefined();
    expect(catalogRow(null, "addon", "newsletter", "standard")).toBeUndefined();
  });
});

describe("priceLabelFor", () => {
  it("monthly rows read $9/mo", () => {
    expect(
      priceLabelFor(
        row({
          itemKind: "addon",
          itemKey: "x",
          path: "standard",
          monthlyCents: 900,
        }),
      ),
    ).toBe("$9/mo");
  });
  it("one-time rows read $300 once", () => {
    expect(
      priceLabelFor(
        row({
          itemKind: "extra",
          itemKey: "x",
          path: "standard",
          oneTimeCents: 30000,
        }),
      ),
    ).toBe("$300 once");
  });
  it("unpriced or missing rows read Price coming soon", () => {
    expect(
      priceLabelFor(row({ itemKind: "addon", itemKey: "x", path: "standard" })),
    ).toBe(PRICE_SOON);
    expect(priceLabelFor(undefined)).toBe(PRICE_SOON);
    expect(priceLabelFor(null)).toBe(PRICE_SOON);
  });
});

describe("pathPriceLine", () => {
  it("null catalog hides the line", () => {
    expect(pathPriceLine(null, "standard")).toBeNull();
  });
  it("priced path reads build then monthly", () => {
    expect(pathPriceLine(CATALOG, "standard")).toBe(
      "$1,500 build, then $39 a month",
    );
  });
  it("an unpriced part reads Price coming soon", () => {
    expect(pathPriceLine(CATALOG, "studio")).toBe(PRICE_SOON);
    expect(pathPriceLine([], "standard")).toBe(PRICE_SOON);
  });
});
