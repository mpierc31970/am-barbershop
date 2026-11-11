// 15-15 (HUB-05, HUB-06; D180, D264, D296, A2-Q1, A2-Q4; T-15-15-01..03): the hub pricing page.
// Imports the shared marketing mocks first (P15-P27).
import {
  mockMarketingData,
  PRICED_CATALOG,
  UNPRICED_CATALOG,
} from "./helpers/marketing-mocks";
import { MK_GATEWAY_SENTENCE } from "@cds/core/marketing";
import {
  formatCents,
  formatMonthly,
  formatYearly,
  type CatalogRow,
} from "@cds/core/pricing";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PricingPage, {
  dynamic,
  generateMetadata,
} from "../app/(platform)/(marketing)/pricing/page";

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.spyOn(console, "error").mockImplementation(() => {});

const care = (path: CatalogRow["path"], cents: number): CatalogRow => ({
  itemKind: "care_plan",
  itemKey: "care",
  path,
  monthlyCents: cents,
  oneTimeCents: null,
  installments: null,
});

const WITH_CARE: CatalogRow[] = [
  ...PRICED_CATALOG,
  care("standard", 4900),
  care("studio", 4900),
];

const plan = (path: "standard" | "studio") => {
  const monthly = PRICED_CATALOG.find(
    (r) => r.itemKind === "plan" && r.path === path,
  )?.monthlyCents;
  const build = PRICED_CATALOG.find(
    (r) => r.itemKind === "build_fee" && r.path === path,
  )?.oneTimeCents;
  if (monthly == null || build == null) throw new Error("fixture changed");
  return { monthly, build };
};

/** React escapes `'` in text; compare against the escaped form. */
const esc = (s: string) => s.replace(/'/g, "&#x27;");

async function render(): Promise<string> {
  const el = await PricingPage();
  return renderToStaticMarkup(el as ReactElement);
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

beforeEach(() => {
  mockMarketingData({ catalog: WITH_CARE });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hub pricing", () => {
  it("is dynamic per request (no ISR)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("prints both plans from the catalog with the computed yearly figure (D180)", async () => {
    const html = await render();
    for (const path of ["standard", "studio"] as const) {
      const { monthly, build } = plan(path);
      expect(html).toContain(formatMonthly(monthly));
      expect(html).toContain(`${formatCents(build)} one-time build`);
      expect(html).toContain(formatYearly(monthly * 10));
    }
    expect(html).toContain("Or pay yearly and get 2 months free");
    expect(html).toContain('href="/start?path=standard"');
    expect(html).toContain('href="/start?path=studio"');
    expect(html.replace(/&amp;/g, "&")).toContain(
      'href="/contact?topic=question&about=shop"',
    );
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it("prints the add-on table by path and the Care Plan from the catalog", async () => {
    const html = await render();
    expect(html).toContain('id="add-on-prices"');
    expect(html).toContain("Add-on prices by path");
    expect(html).toContain(formatMonthly(1200)); // builder-pro on Standard
    expect(html).toContain("Included"); // builder-pro on Studio (0 cents)
    expect(html).toContain("Not on this path"); // testimonials on Studio
    expect(html).toContain('href="/add-ons/builder-pro"');
    expect(html).toContain('id="care-plan"');
    expect(html).toContain(`Standard · ${formatMonthly(4900)}`);
    expect(html).toContain("Add it when you start");
  });

  it("reads Price coming soon and prints no yearly figure when unpriced", async () => {
    mockMarketingData({ catalog: UNPRICED_CATALOG, production: true });
    const html = await render();
    expect(html).toContain("Price coming soon");
    expect(html).toContain("Or pay yearly and get 2 months free");
    expect(html).not.toMatch(/\/yr/);
    expect(html).not.toMatch(/\$\d/);
  });

  it("prints no catalog figures when the catalog read fails (A2-Q1)", async () => {
    mockMarketingData({ catalog: null, production: true });
    const html = await render();
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain("one-time build");
    expect(html).not.toContain("Or pay yearly");
    expect(html).toContain("Pricing");
  });

  it("hides comparison, calculator and sources in production with only draft claims", async () => {
    mockMarketingData({ catalog: WITH_CARE, production: true });
    const html = await render();
    expect(html).not.toContain('id="how-they-make-their-money"');
    expect(html).not.toContain('id="calculator"');
    expect(html).not.toContain('id="sources"');
    expect(html).not.toContain("DRAFT");
    // The gateway sentence is only in Good to know (no comparison band).
    expect(count(html, esc(MK_GATEWAY_SENTENCE))).toBe(1);
  });

  it("shows drafts in dev with DRAFT badges, the gateway sentence with the comparison", async () => {
    const html = await render();
    const cmp = html.indexOf('id="how-they-make-their-money"');
    const calc = html.indexOf('id="calculator"');
    const src = html.indexOf('id="sources"');
    expect(cmp).toBeGreaterThan(0);
    expect(calc).toBeGreaterThan(cmp);
    expect(src).toBeGreaterThan(calc);
    expect(html).toContain("DRAFT");
    expect(html).toContain("How they make their money, and how we don");
    expect(html).toContain("What would you keep?");
    const gateway = html.indexOf(esc(MK_GATEWAY_SENTENCE), cmp);
    expect(gateway).toBeGreaterThan(cmp);
    expect(gateway).toBeLessThan(calc);
    expect(count(html, esc(MK_GATEWAY_SENTENCE))).toBeGreaterThan(1);
  });

  it("renders the sections in UI-SPEC order", async () => {
    const html = await render();
    const order = [
      "mk-pricing-h1",
      "mk-plan-standard",
      'id="add-on-prices"',
      'id="care-plan"',
      "What it costs, worked out",
      'id="how-they-make-their-money"',
      'id="calculator"',
      "Good to know",
      'id="sources"',
      "See your full price before you commit.",
    ].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("If you leave");
  });

  it("metadata: noindex in dev, apex canonical in production", async () => {
    const dev = await generateMetadata();
    expect(dev.title).toBe("Pricing · Connections Design Studios");
    expect(dev.alternates?.canonical).toBeUndefined();
    mockMarketingData({ production: true });
    const prod = await generateMetadata();
    expect(String(prod.alternates?.canonical)).toMatch(/\/pricing$/);
  });
});
