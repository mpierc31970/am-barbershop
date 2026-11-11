// The one shared mock for CDS hub page tests (15-13; P15-P27). Every marketing page test
// imports this module FIRST (before any page or lib module), then calls mockMarketingData()
// in beforeEach. The vi.mock calls below register when this module loads, so modules the
// test imports afterwards get the mocked versions:
//   - ../../lib/catalog        getCatalog          -> state.catalog (Error = rejects)
//   - ../../lib/catalog-view   getCatalogState/View -> state.view + state.degraded (rest real)
//   - @cds/db                  readDemoSiteUrl     -> state.demoUrl (rest real)
//   - next/cache               unstable_cache      -> the function itself (no Next cache in tests)
//   - CDS_ENV                  "production" when `production: true`, else "dev"
// Never re-mock these differently in a page test.
import type { CatalogRow } from "@cds/core/pricing";
import type { CatalogEntry } from "@cds/db";
import { vi } from "vitest";

type MockState = {
  catalog: CatalogRow[] | Error;
  view: CatalogEntry[];
  degraded: boolean;
  demoUrl: string | null | Error;
};

const state = vi.hoisted((): { current: MockState } => ({
  current: { catalog: [], view: [], degraded: false, demoUrl: null },
}));

vi.mock("next/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/cache")>();
  return {
    ...actual,
    unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    revalidateTag: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("../../lib/catalog", () => ({
  getCatalog: vi.fn(async () => {
    const c = state.current.catalog;
    if (c instanceof Error) throw c;
    return c;
  }),
}));

vi.mock("../../lib/catalog-view", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/catalog-view")>();
  const getCatalogState = vi.fn(async () => ({
    view: state.current.view,
    degraded: state.current.degraded,
  }));
  return {
    ...actual,
    getCatalogState,
    getCatalogView: vi.fn(async () => state.current.view),
    getPickableSlugs: vi.fn(async () =>
      state.current.degraded ? null : actual.pickableSlugs(state.current.view),
    ),
  };
});

vi.mock("@cds/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cds/db")>();
  return {
    ...actual,
    readDemoSiteUrl: vi.fn(async () => {
      const u = state.current.demoUrl;
      if (u instanceof Error) throw u;
      return u;
    }),
  };
});

const row = (
  itemKind: CatalogRow["itemKind"],
  itemKey: string,
  path: CatalogRow["path"],
  monthlyCents: number | null,
  oneTimeCents: number | null = null,
): CatalogRow => ({
  itemKind,
  itemKey,
  path,
  monthlyCents,
  oneTimeCents,
  installments: null,
});

/** Both paths priced; Builder Pro 1200 on Standard, 0 (Included) on Studio; credentials 900 on both; testimonials unpriced. */
export const PRICED_CATALOG: CatalogRow[] = [
  row("build_fee", "base", "standard", null, 150000),
  row("plan", "base", "standard", 3900),
  row("build_fee", "base", "studio", null, 250000),
  row("plan", "base", "studio", 7900),
  row("addon", "builder-pro", "standard", 1200),
  row("addon", "builder-pro", "studio", 0),
  row("addon", "credentials", "standard", 900),
  row("addon", "credentials", "studio", 900),
  row("addon", "testimonials", "standard", null),
];

/** Every row unpriced (null amounts): every label reads "Price coming soon". */
export const UNPRICED_CATALOG: CatalogRow[] = PRICED_CATALOG.map((r) => ({
  ...r,
  monthlyCents: null,
  oneTimeCents: null,
}));

const entry = (
  slug: string,
  name: string,
  path: CatalogEntry["path"],
  availability: CatalogEntry["availability"] = "available",
): CatalogEntry => ({
  slug,
  name,
  tagline: `${name} tagline`,
  description: `${name} description`,
  screenshots: [],
  availability,
  sort: 1000,
  pickable: availability === "available",
  private: false,
  path,
  premium: false,
});

/** Three public add-ons in listing order. */
export const PUBLIC_VIEW: CatalogEntry[] = [
  entry("builder-pro", "Builder Pro", "both"),
  entry("credentials", "Credentials", "both"),
  entry("testimonials", "Testimonials", "standard"),
];

/** The manifest-only fallback shape: every entry coming soon, nothing pickable. */
export const DEGRADED_VIEW: CatalogEntry[] = PUBLIC_VIEW.map((e) => ({
  ...e,
  availability: "coming_soon",
  pickable: false,
}));

export type MarketingMockOptions = {
  /** Price rows, null = the price read throws. Default PRICED_CATALOG. */
  catalog?: CatalogRow[] | null;
  /** Public view. Default PUBLIC_VIEW (DEGRADED_VIEW when degraded). */
  view?: CatalogEntry[];
  /** Listing read failed (fallback view). Default false. */
  degraded?: boolean;
  /** Demo link, null = no demo, "throw" = the read fails. Default a preview host URL. */
  demoUrl?: string | null | "throw";
  /** CDS_ENV=production when true, else dev. Default false. */
  production?: boolean;
};

export const DEMO_URL = "https://demo.sites.connectionsdesignstudios.com/";

/** Set the mocked catalog, view, demo link and CDS_ENV for the next reads. */
export function mockMarketingData(opts: MarketingMockOptions = {}): void {
  const degraded = opts.degraded ?? false;
  state.current = {
    catalog:
      opts.catalog === null
        ? new Error("catalog down")
        : (opts.catalog ?? PRICED_CATALOG),
    view: opts.view ?? (degraded ? DEGRADED_VIEW : PUBLIC_VIEW),
    degraded,
    demoUrl:
      opts.demoUrl === "throw"
        ? new Error("demo down")
        : opts.demoUrl === undefined
          ? DEMO_URL
          : opts.demoUrl,
  };
  vi.stubEnv("CDS_ENV", opts.production ? "production" : "dev");
}
