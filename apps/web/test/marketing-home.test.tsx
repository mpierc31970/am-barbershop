// 15-14 (HUB-01, HUB-02; D264, A1-Q6, A3-Q4; T-15-14-01..03): the hub home page.
// Imports the shared marketing mocks first (P15-P27).
import {
  DEMO_URL,
  mockMarketingData,
  UNPRICED_CATALOG,
} from "./helpers/marketing-mocks";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage, {
  dynamic,
  generateMetadata,
} from "../app/(platform)/(marketing)/page";

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.spyOn(console, "error").mockImplementation(() => {});

async function render(): Promise<string> {
  const el = await HomePage();
  return renderToStaticMarkup(el as ReactElement);
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) =>
    (m[1] ?? "").replace(/&amp;/g, "&"),
  );
}

beforeEach(() => {
  mockMarketingData();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hub home", () => {
  it("is dynamic per request (no ISR)", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("prints the catalog's Standard price line and the three /start CTAs", async () => {
    const html = await render();
    expect(html).toContain("$1,500 build, then $39 a month");
    expect(html).toContain("$2,500 build, then $79 a month");
    const links = hrefs(html);
    expect(links).toContain("/start");
    expect(links).toContain("/start?path=standard");
    expect(links).toContain("/start?path=studio");
    expect(links).toContain("/pricing");
    expect(links).toContain("/contact?topic=question&about=shop");
  });

  it("renders the sections in UI-SPEC order with exactly one h1", async () => {
    const html = await render();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    const order = [
      "We build your website. Then we keep it running.",
      "Two ways to start",
      "What it costs, worked out",
      "How it works",
      "See a real site in action",
      "We keep your monthly price.",
      "See your full price before you commit.",
    ].map((s) => html.indexOf(s.replace(/'/g, "&#x27;")));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("foundations");
  });

  it("shows worked examples from the catalog (the practitioner)", async () => {
    const html = await render();
    expect(html).toContain("A practitioner");
    // v1.1 add-ons (appointments, studio-booking) are outside the public view: hidden.
    expect(html).not.toContain("A coach");
  });

  it("reads Price coming soon when the catalog is unpriced", async () => {
    mockMarketingData({ catalog: UNPRICED_CATALOG });
    const html = await render();
    expect(html).toContain("Price coming soon");
    expect(html).not.toMatch(/\$\d/);
  });

  it("prints no price line and hides examples when the catalog read fails", async () => {
    mockMarketingData({ catalog: null });
    const html = await render();
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain("Price coming soon");
    expect(html).not.toContain("data-mk-path-price");
    expect(html).not.toContain("What it costs, worked out");
  });

  it("shows the demo links when the demo URL resolves, none when it does not", async () => {
    const withDemo = await render();
    expect(hrefs(withDemo)).toContain(DEMO_URL);
    expect(withDemo).toContain("See a live demo");

    mockMarketingData({ demoUrl: null });
    const none = await render();
    expect(none).not.toContain(DEMO_URL);
    expect(none).not.toContain("See a live demo");
    expect(none).not.toContain("See a real site in action");
  });

  it("hides unconfirmed proof in production", async () => {
    mockMarketingData({ production: true });
    const html = await render();
    expect(html).not.toContain("Sites we&#x27;ve built");
    expect(html).not.toContain("Palm Science");
    expect(html).not.toContain("DRAFT");
  });

  it("WR-A05: the money link shows only when Pricing renders its comparison anchor", async () => {
    const dev = await render();
    expect(hrefs(dev)).toContain("/pricing#how-they-make-their-money");
    // Production with only draft claims: Pricing has no #how-they-make-their-money.
    mockMarketingData({ production: true });
    const prod = await render();
    expect(hrefs(prod)).not.toContain("/pricing#how-they-make-their-money");
    expect(prod).not.toContain("See how other platforms charge");
    // The money line itself still shows.
    expect(prod).toContain("We keep your monthly price.");
  });

  it("shows proof with DRAFT badges outside production", async () => {
    const html = await render();
    expect(html).toContain("Sites we&#x27;ve built");
    expect(html).toContain("Palm Science");
    expect(html).toContain("DRAFT");
    expect(hrefs(html)).toContain("/work");
  });

  it("emits parseable Organization JSON-LD with < escaped", async () => {
    const html = await render();
    const m = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    expect(m).not.toBeNull();
    const body = m![1] ?? "";
    expect(body).not.toContain("<");
    const ld = JSON.parse(body) as Record<string, string>;
    expect(ld["@type"]).toBe("Organization");
    expect(ld.name).toBe("Connections Design Studios");
    expect(ld.url).toBe("https://connectionsdesignstudios.com");
    expect(ld.email).toBe("hello@connectionsdesignstudios.com");
  });

  it("metadata: noindex and no canonical outside production", async () => {
    const md = await generateMetadata();
    expect(md.title).toBe(
      "Connections Design Studios: websites built and run for small businesses",
    );
    expect(md.description).toContain("Pick a path and the parts you need.");
    expect(md.robots).toEqual({ index: false, follow: false });
    expect(md.alternates?.canonical).toBeUndefined();
  });

  it("metadata: indexable with the apex canonical in production", async () => {
    mockMarketingData({ production: true });
    const md = await generateMetadata();
    expect(md.robots).toBeUndefined();
    expect(md.alternates?.canonical).toBe(
      "https://connectionsdesignstudios.com/",
    );
  });
});
