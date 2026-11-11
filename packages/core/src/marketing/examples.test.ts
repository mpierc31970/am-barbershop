// Worked examples are selections, totals come from the catalog (D264, D300; 15-05 choice 5).
import { describe, expect, it } from "vitest";
import { formatMonthly, type CatalogRow } from "../pricing";
import {
  EXAMPLES,
  exampleAddonKey,
  exampleTotal,
  type MkExample,
} from "./examples";

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
    itemKind: "plan",
    itemKey: "base",
    path: "standard",
    monthlyCents: 3900,
  }),
  row({
    itemKind: "plan",
    itemKey: "base",
    path: "studio",
    monthlyCents: 4900,
  }),
  row({
    itemKind: "addon",
    itemKey: "newsletter",
    path: "standard",
    monthlyCents: 1500,
  }),
  row({
    itemKind: "addon",
    itemKey: "appointments",
    path: "standard",
    monthlyCents: 2900,
  }),
  row({ itemKind: "addon", itemKey: "credentials", path: "standard" }),
  row({
    itemKind: "addon",
    itemKey: "builder-pro",
    path: "studio",
    monthlyCents: 0,
  }),
];

const coach: MkExample = {
  id: "t-coach",
  title: "A coach",
  path: "standard",
  addons: ["appointments", "newsletter"],
};

const ALL = new Set([
  "appointments",
  "newsletter",
  "credentials",
  "builder-pro",
]);

describe("EXAMPLES", () => {
  it("names D300's coach and salon plus a practitioner, as selections only", () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(ids).toEqual(["coach", "salon", "practitioner"]);
    for (const e of EXAMPLES) {
      const keys = Object.keys(e).filter((k) => k !== "staff");
      expect(keys.sort()).toEqual(["addons", "id", "path", "title"]);
    }
  });
});

describe("exampleTotal", () => {
  it("sums the plan and add-on rows when every part is priced", () => {
    const t = exampleTotal(coach, CATALOG, ALL);
    expect(t).toEqual({
      label: formatMonthly(8300),
      monthlyCents: 8300,
      parts: [
        { name: "Standard", chipKey: "standard" },
        { name: "Appointments", chipKey: "appointments" },
        { name: "Newsletter", chipKey: "newsletter" },
      ],
    });
  });

  it("an included (zero-priced) add-on counts as priced", () => {
    const t = exampleTotal(
      { id: "x", title: "X", path: "studio", addons: ["builder-pro"] },
      CATALOG,
      ALL,
    );
    expect(t?.label).toBe(formatMonthly(4900));
    expect(t?.monthlyCents).toBe(4900);
  });

  it("any unpriced or missing row reads Price coming soon", () => {
    const unpriced = exampleTotal(
      { id: "p", title: "P", path: "standard", addons: ["credentials"] },
      CATALOG,
      ALL,
    );
    expect(unpriced?.label).toBe("Price coming soon");
    expect(unpriced?.monthlyCents).toBeNull();

    const noPlan = exampleTotal(coach, CATALOG.slice(1), ALL);
    expect(noPlan?.label).toBe("Price coming soon");
    expect(noPlan?.monthlyCents).toBeNull();
  });

  it("hides (null) when a named add-on is not in the public view", () => {
    expect(exampleTotal(coach, CATALOG, new Set(["newsletter"]))).toBeNull();
  });

  it("hides (null) when the catalog did not load", () => {
    expect(exampleTotal(coach, null, ALL)).toBeNull();
  });

  it("WR-B09: the 3-stylist salon prices Studio Booking from its team tier row", () => {
    const salon = EXAMPLES.find((e) => e.id === "salon")!;
    expect(salon.staff).toBe(3);
    expect(exampleAddonKey(salon, "studio-booking")).toBe(
      "studio-booking-team",
    );
    // The catalog has tier rows only (migration 1790000780), never studio-booking itself.
    const tiers = [
      ...CATALOG,
      row({
        itemKind: "addon",
        itemKey: "studio-booking-solo",
        path: "studio",
        monthlyCents: 4900,
      }),
      row({
        itemKind: "addon",
        itemKey: "studio-booking-team",
        path: "studio",
        monthlyCents: 9900,
      }),
      row({
        itemKind: "addon",
        itemKey: "studio-booking-large-team",
        path: "studio",
        monthlyCents: 17900,
      }),
    ];
    const t = exampleTotal(salon, tiers, new Set(["studio-booking"]));
    expect(t?.monthlyCents).toBe(4900 + 9900);
    expect(t?.label).toBe(formatMonthly(14800));
    expect(t?.parts.map((p) => p.chipKey)).toEqual([
      "studio",
      "studio-booking",
    ]);
  });

  it("every example naming Studio Booking carries a staff count", () => {
    for (const e of EXAMPLES.filter((x) =>
      x.addons.includes("studio-booking"),
    )) {
      expect(Number.isSafeInteger(e.staff)).toBe(true);
    }
  });

  it("v1.0 registry: only the practitioner renders", () => {
    const v1 = new Set(["builder-pro", "credentials", "testimonials"]);
    const shown = EXAMPLES.filter((e) => exampleTotal(e, CATALOG, v1) !== null);
    expect(shown.map((e) => e.id)).toEqual(["practitioner"]);
  });
});
